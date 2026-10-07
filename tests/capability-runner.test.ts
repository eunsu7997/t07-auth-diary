import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { Socket } from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { compileObservation, requestFingerprint, type Operation } from '../scripts/capability/protocol.ts';
import { TrustedObservationSupervisor, FixtureObservationSupervisor, readActualReceipt, runnerEnvironment } from '../scripts/capability/supervisor.ts';
import { evaluateRecoveryProbe } from '../scripts/capability/recovery-gate.ts';
import { CloudflareReadonlyHttp } from '../scripts/stage3e2a/control-plane-http.ts';
import { CloudflareControlPlaneObserver } from '../scripts/stage3e2a/control-plane.ts';
import type { TargetPolicy } from '../scripts/stage3e2a/transport.ts';
const target = (): TargetPolicy => ({ purpose: 'DISPOSABLE_TEST', expectedDatabaseId: crypto.randomUUID(), expectedAccountId: crypto.randomUUID().replaceAll('-', ''), expectedName: 'aleph-t07-disposable-capability-fixture', deniedDatabaseIds: [crypto.randomUUID()], explicitConfirmation: true });
const query = { kind: 'QUERY', id: 'PROXY' } as const;
let fetchCalls = 0, socketCalls = 0;
let fetchSpy: ReturnType<typeof vi.spyOn>, socketSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { fetchCalls++; return new Response(JSON.stringify({ success: true, result: {} })); });
  socketSpy = vi.spyOn(Socket.prototype, 'connect').mockImplementation(function () { socketCalls++; throw new Error('LOCAL_NETWORK_FORBIDDEN'); } as never);
});
afterEach(() => vi.useRealTimers());
afterAll(() => { fetchSpy.mockRestore(); socketSpy.mockRestore(); expect(fetchCalls).toBe(0); expect(socketCalls).toBe(0); });
describe('method and body observation gate', () => {
  it.each(['PROXY', 'TABLES', 'TRIGGERS', 'FK_CHECK', 'SESSION_COUNT'])('fixed %s compiles exact POST body', id => {
    const p = target(), wire = compileObservation(p, { kind: 'QUERY', id });
    expect(wire.method).toBe('POST'); expect(wire.path).toBe(`/client/v4/accounts/${p.expectedAccountId}/d1/database/${p.expectedDatabaseId}/query`);
    expect(JSON.parse(wire.body).params).toEqual([]); expect(Object.isFrozen(wire)).toBe(true);
  });
  it.each([
    { kind: 'QUERY', id: 'DELETE FROM plans' }, { kind: 'QUERY', id: 'PROXY', sql: 'DELETE FROM plans' },
    { kind: 'QUERY', id: 'PROXY', params: ['DELETE'] }, { kind: 'QUERY', id: 'PROXY', method: 'DELETE' },
    { kind: 'QUERY', id: 'PRAGMA foreign_keys=OFF' }, { kind: 'BATCH', id: 'PROXY' },
  ])('rejects caller mutation request %#', operation => { expect(() => compileObservation(target(), operation as Operation)).toThrow('OBSERVATION_REQUEST_DENIED'); });
  it('fingerprint binds SQL body and target', () => {
    const p = target(); expect(requestFingerprint(p, query)).not.toBe(requestFingerprint(p, { kind: 'QUERY', id: 'SESSION_COUNT' }));
    expect(requestFingerprint(p, query)).not.toBe(requestFingerprint(target(), query));
  });
  it('GET cannot reach query/write endpoint', () => { const p = target(); expect(() => compileObservation(p, { kind: 'GET', path: `/client/v4/accounts/${p.expectedAccountId}/d1/database/${p.expectedDatabaseId}/query` })).toThrow(); });
  it.each(['?sql=DELETE', '?page=1', '#fragment'])('fixed metadata rejects extra query/fragment %s', suffix => { const p = target(); expect(() => compileObservation(p, { kind: 'GET', path: `/client/v4/accounts/${p.expectedAccountId}${suffix}` })).toThrow(); });
  it('inventory requires exact account query and pagination', () => {
    const p = target(); expect(compileObservation(p, { kind: 'GET', path: `/client/v4/zones?account.id=${p.expectedAccountId}&page=1&per_page=100` }).method).toBe('GET');
    for (const suffix of [`account.id=${p.expectedAccountId}&page=21&per_page=100`, 'account.id=wrong&page=1&per_page=100', `account.id=${p.expectedAccountId}&page=1&per_page=100&page=2`]) expect(() => compileObservation(p, { kind: 'GET', path: '/client/v4/zones?' + suffix })).toThrow();
  });
  it('production purpose and denied exact target are rejected', () => { const p = target(); expect(() => compileObservation({ ...p, purpose: 'PRODUCTION_T07' }, query)).toThrow(); expect(() => compileObservation({ ...p, deniedDatabaseIds: [p.expectedDatabaseId] }, query)).toThrow(); });
});
describe('private fixture leases and receipts', () => {
  const fixture = (p = target()) => new FixtureObservationSupervisor(p, async () => ({ success: true, result: [] }));
  it('one use, private receipt, always fake and never actual', async () => {
    const s = fixture(), lease = s.lease(query), receipt = await s.observe(query, lease);
    expect(readActualReceipt(receipt)).toBeUndefined(); expect(s.consume(receipt, query).origin).toBe('FAKE_CONTROL_PLANE');
    expect(() => s.consume(receipt, query)).toThrow(); await expect(s.observe(query, lease)).rejects.toThrow();
  });
  it('copied/forged lease and receipt cannot be used', async () => {
    const s = fixture(), lease = s.lease(query); await expect(s.observe(query, { ...lease })).rejects.toThrow(); await expect(s.observe(query, {})).rejects.toThrow();
    const receipt = await s.observe(query, lease); expect(() => s.consume({ ...receipt }, query)).toThrow(); expect(() => s.consume({}, query)).toThrow();
  });
  it('wrong session/target supervisor cannot consume', async () => {
    const p = target(), s = fixture(p), otherSession = fixture(p), otherTarget = fixture(); const lease = s.lease(query);
    await expect(otherSession.observe(query, lease)).rejects.toThrow(); await expect(otherTarget.observe(query, lease)).rejects.toThrow();
    const receipt = await s.observe(query, lease); expect(() => otherSession.consume(receipt, query)).toThrow();
  });
  it('wrong action/body does not consume correct lease', async () => {
    const s = fixture(), lease = s.lease(query); await expect(s.observe({ kind: 'QUERY', id: 'SESSION_COUNT' }, lease)).rejects.toThrow(); expect(await s.observe(query, lease)).toBeDefined();
  });
  it('expired lease and stale receipt fail', async () => {
    vi.useFakeTimers(); const s = fixture(), lease = s.lease(query); vi.advanceTimersByTime(30000); await expect(s.observe(query, lease)).rejects.toThrow();
    const receipt = await s.observe(query, s.lease(query)); vi.advanceTimersByTime(30001); expect(() => s.consume(receipt, query)).toThrow();
  });
  it('freshness starts at completion but overly long observation fails closed', async () => {
    vi.useFakeTimers(); const s = new FixtureObservationSupervisor(target(), async () => { vi.advanceTimersByTime(10000); return { success: true, result: [] }; });
    const receipt = await s.observe(query, s.lease(query)); vi.advanceTimersByTime(25000); expect(s.consume(receipt, query).origin).toBe('FAKE_CONTROL_PLANE');
    const slow = new FixtureObservationSupervisor(target(), async () => { vi.advanceTimersByTime(30001); return { success: true, result: [] }; }); await expect(slow.observe(query, slow.lease(query))).rejects.toThrow();
  });
  it('closed or failed observation cannot be retried', async () => {
    const s = new FixtureObservationSupervisor(target(), async () => { throw new Error('SYNTHETIC_FAILURE'); }), lease = s.lease(query); await expect(s.observe(query, lease)).rejects.toThrow(); await expect(s.observe(query, lease)).rejects.toThrow('OBSERVATION_AUTHORITY_DENIED');
    const closed = fixture(), l = closed.lease(query); closed.close(); await expect(closed.observe(query, l)).rejects.toThrow();
  });
});
describe('fixed runner trust boundary and local-only state', () => {
  it('spawn environment is allowlist, not inherited loader/TLS/proxy settings', () => {
    const env = runnerEnvironment({ SystemRoot: 'C:\\Windows', TEMP: 'fixture-temp', NODE_OPTIONS: '--import malicious', NODE_EXTRA_CA_CERTS: 'malicious', NODE_TLS_REJECT_UNAUTHORIZED: '0', HTTPS_PROXY: 'malicious', SSL_CERT_FILE: 'malicious', NODE_USE_ENV_PROXY: '1', PATH: 'malicious' });
    expect(Object.keys(env).sort()).toEqual(['SystemRoot', 'TEMP']);
  });
  it('fixed child entry executes offline with no actual receipt', async () => {
    const result = await new TrustedObservationSupervisor(target()).localCheck(query); expect(result).toEqual({ kind: 'OFFLINE_CHECK', method: 'POST' }); expect(readActualReceipt(result)).toBeUndefined();
  });
  it('patched global fetch cannot issue actual observation', async () => {
    const p = target(), credentials = vi.fn(async () => 'fixture-secret-never-read'), observer = new CloudflareControlPlaneObserver(p, new CloudflareReadonlyHttp(p, credentials));
    expect((await observer.observeAccount()).state).toBe('UNKNOWN'); expect(credentials).not.toHaveBeenCalled(); expect(fetchCalls).toBe(0);
  });
  it('trusted supervisor denies actual remote observation before spawn', async () => { await expect(new TrustedObservationSupervisor(target()).observe(query)).rejects.toThrow('OBSERVATION_AUTHORITY_DENIED'); });
  it('runner remote mode is fail closed even when invoked directly', async () => {
    const p = target(); const response = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/capability/runner.mjs', import.meta.url))], { shell: false, windowsHide: true, env: runnerEnvironment(process.env) }); let output = '';
      child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => output += chunk); child.stderr.resume(); child.on('error', reject); child.on('close', () => resolve(output));
      child.stdin.end(JSON.stringify({ mode: 'REMOTE_READ', target: p, operation: query, nonce: 'a'.repeat(64) }));
    }); expect(JSON.parse(response)).toEqual({ kind: 'DENIED' });
  });
  it('actual runner has no fetch and parent does not fork/inherit execArgv', () => {
    const runner = readFileSync(new URL('../scripts/capability/runner.mjs', import.meta.url), 'utf8'), supervisor = readFileSync(new URL('../scripts/capability/supervisor.ts', import.meta.url), 'utf8');
    expect(runner).not.toMatch(/\bfetch\(/); expect(runner).toContain('rejectUnauthorized: true'); expect(supervisor).toContain('shell: false'); expect(supervisor).not.toMatch(/\bfork\(/);
  });
});
describe('disposable recovery bootstrap planning', () => {
  const facts = { identity: true, bookmark: true, disposableApproved: true, policyPermission: 'UNKNOWN' } as const;
  it('UNKNOWN policy allows only accepted-risk recovery planning, never a grant', () => { expect(evaluateRecoveryProbe(target(), facts)).toEqual({ state: 'ACCEPTED_RISK', executionApproved: false, scope: 'DISPOSABLE_TEST_RECOVERY_ONLY' }); });
  it.each(['identity', 'bookmark', 'disposableApproved', 'policyPermission'] as const)('missing/denied %s blocks planning', key => { expect(evaluateRecoveryProbe(target(), { ...facts, [key]: false }).state).toBe('DENIED'); });
  it('production never gets recovery probe planning permission', () => { expect(() => evaluateRecoveryProbe({ ...target(), purpose: 'PRODUCTION_T07' }, facts)).toThrow(); });
});
