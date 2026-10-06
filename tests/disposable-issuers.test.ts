import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from 'vitest';
import { Socket } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createApprovalSession, closeApprovalSession, issueFixtureApproval, requireDisposableApproval, DisposableApprovalAuthority } from '../scripts/stage3e2a/approval.ts';
import { FakeControlPlaneObserver, CloudflareControlPlaneObserver, controlPlanePrecheck, readControlPlaneValue, readRemoteControlPlaneValue } from '../scripts/stage3e2a/control-plane.ts';
import { CloudflareReadonlyHttp, FakeControlPlaneHttp } from '../scripts/stage3e2a/control-plane-http.ts';
import type { ApprovalContext, TargetPolicy } from '../scripts/stage3e2a/transport.ts';
import { FakeCloudflareD1Transport } from '../scripts/stage3e2a/transport.ts';
import { DisposableRemoteD1Provider, providerSession } from '../scripts/stage3e2a/provider.ts';
const policy = (): TargetPolicy => ({ purpose: 'DISPOSABLE_TEST', expectedDatabaseId: crypto.randomUUID(), expectedAccountId: crypto.randomUUID().replace(/-/g, ''), expectedName: 'aleph-t07-disposable-issuer-fixture', deniedDatabaseIds: [crypto.randomUUID()], explicitConfirmation: true });
const context = (): ApprovalContext => ({ policy: policy(), session: createApprovalSession('FAKE_TRANSPORT'), action: 'BATCH', transportOrigin: 'FAKE_TRANSPORT' });
const network = { fetch: 0, socket: 0 };
let f: ReturnType<typeof vi.spyOn>, s: ReturnType<typeof vi.spyOn>;
beforeAll(() => { f = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { network.fetch++; throw new Error('NETWORK_FORBIDDEN'); }); s = vi.spyOn(Socket.prototype, 'connect').mockImplementation(function () { network.socket++; throw new Error('NETWORK_FORBIDDEN'); } as never); });
afterEach(() => vi.unstubAllEnvs());
afterAll(() => { f.mockRestore(); s.mockRestore(); mkdirSync('evidence/t07/issuers', { recursive: true }); writeFileSync('evidence/t07/issuers/network-observation.json', JSON.stringify({ ...network, cloudflareApi: 0, remoteD1: 0, proxy: 0, deploy: 0, actualSignup: 0, actualImport: 0, scope: 'Local tests; fake HTTP is not real control-plane evidence; official documentation browsing is separate' }, null, 2) + '\n'); });
describe('Disposable approval private issuer', () => {
  it('normal private mint validates and consumes exactly once in fixture scope', () => { const ctx = context(), approval = issueFixtureApproval(ctx); expect(Object.isFrozen(approval)).toBe(true); expect(() => requireDisposableApproval(approval, ctx, true)).not.toThrow(); expect(() => requireDisposableApproval(approval, ctx, true)).toThrow('DISPOSABLE_REMOTE_TEST_NOT_APPROVED'); });
  it('same approval reaches fake transport boundary and cannot execute twice', async () => {
    const p = policy(); let submissions = 0;
    const fake = new FakeCloudflareD1Transport({ identity: { accountId: p.expectedAccountId, databaseId: p.expectedDatabaseId, name: p.expectedName, purpose: 'DISPOSABLE_TEST' }, writers: { workerDeployment: false, routes: false, scheduledWriters: false, otherBindings: false }, recovery: { timeTravelAvailable: true, retentionDays: 7, bookmarkReadable: true, restorePermission: true }, verification: { read: true, review: true, export: true, attackTests: true } }, { query: async () => ({ success: true, results: [] }), batch: async () => { submissions++; return [{ success: true, results: [] }]; } });
    const provider = new DisposableRemoteD1Provider(p, fake); await provider.connect();
    const approval = issueFixtureApproval({ policy: p, session: providerSession(provider)!, action: 'BATCH', transportOrigin: 'FAKE_TRANSPORT' });
    expect(await provider.execute([{ sql: 'SELECT 1 AS proxy_ok', params: [] }], approval)).toEqual([{ success: true, results: [] }]);
    await expect(provider.execute([{ sql: 'SELECT 1 AS proxy_ok', params: [] }], approval)).rejects.toThrow('DISPOSABLE_REMOTE_TEST_NOT_APPROVED'); expect(submissions).toBe(1); await provider.disconnect();
  });
  it.each(['session', 'database', 'account', 'action', 'name', 'production', 'remote origin', 'copied', 'forged'] as const)('rejects %s without consuming correct approval', kind => {
    const ctx = context(); const original = issueFixtureApproval(ctx); let candidate: unknown = original; let wrong = ctx;
    if (kind === 'session') wrong = { ...ctx, session: createApprovalSession('FAKE_TRANSPORT') };
    if (kind === 'database') wrong = { ...ctx, policy: { ...ctx.policy, expectedDatabaseId: crypto.randomUUID() } };
    if (kind === 'account') wrong = { ...ctx, policy: { ...ctx.policy, expectedAccountId: crypto.randomUUID().replace(/-/g, '') } };
    if (kind === 'action') wrong = { ...ctx, action: 'CONNECT' };
    if (kind === 'name') wrong = { ...ctx, policy: { ...ctx.policy, expectedName: 'aleph-t07-disposable-other' } };
    if (kind === 'production') wrong = { ...ctx, policy: { ...ctx.policy, purpose: 'PRODUCTION_T07' } };
    if (kind === 'remote origin') wrong = { ...ctx, transportOrigin: 'REMOTE_TRANSPORT' };
    if (kind === 'copied') candidate = Object.freeze({ ...original });
    if (kind === 'forged') candidate = Object.freeze({ kind: 'DisposableExecutionApproval', expiresAt: Date.now() + 30000, action: 'BATCH' });
    expect(() => requireDisposableApproval(candidate, wrong, true)).toThrow('DISPOSABLE_REMOTE_TEST_NOT_APPROVED'); expect(() => requireDisposableApproval(original, ctx, true)).not.toThrow();
  });
  it('expired and closed-session approvals fail', () => {
    const ctx = context(); const now = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try { const expired = issueFixtureApproval(ctx, 100); clock.mockReturnValue(now + 100); expect(() => requireDisposableApproval(expired, ctx)).toThrow('DISPOSABLE_REMOTE_TEST_NOT_APPROVED'); } finally { clock.mockRestore(); }
    const approval = issueFixtureApproval(ctx); closeApprovalSession(ctx.session); expect(() => requireDisposableApproval(approval, ctx)).toThrow('DISPOSABLE_REMOTE_TEST_NOT_APPROVED');
  });
  it('fixture issuer cannot mint for production or remote session', () => { const ctx = context(); expect(() => issueFixtureApproval({ ...ctx, policy: { ...ctx.policy, purpose: 'PRODUCTION_T07' } })).toThrow(); expect(() => issueFixtureApproval({ ...ctx, session: createApprovalSession('REMOTE_TRANSPORT'), transportOrigin: 'REMOTE_TRANSPORT' })).toThrow('DISPOSABLE_REMOTE_TEST_NOT_APPROVED'); });
  it('unregistered caller session cannot mint', () => { expect(() => issueFixtureApproval({ ...context(), session: Object.freeze({}) })).toThrow('DISPOSABLE_REMOTE_TEST_NOT_APPROVED'); });
  it('invalid expiry is rejected', () => { const ctx = context(); for (const ttl of [0, -1, 30001, NaN, Infinity]) expect(() => issueFixtureApproval(ctx, ttl)).toThrow('DISPOSABLE_REMOTE_TEST_NOT_APPROVED'); });
  it('env flags and fake control-plane cannot authorize actual issuance', async () => {
    vi.stubEnv('DISPOSABLE_EXECUTION_APPROVED', 'true'); const ctx = { ...context(), session: createApprovalSession('REMOTE_TRANSPORT'), transportOrigin: 'REMOTE_TRANSPORT' as const };
    const authority = new DisposableApprovalAuthority(new FakeControlPlaneObserver({ identity: { accountId: ctx.policy.expectedAccountId, databaseId: ctx.policy.expectedDatabaseId, name: ctx.policy.expectedName, purpose: 'DISPOSABLE_TEST' }, writers: { workerDeployment: false, routes: false, scheduledWriters: false, otherBindings: false }, recovery: { timeTravelAvailable: true, bookmarkReadable: true, retentionDays: 30, restorePermission: true } }));
    await expect(authority.authorize(ctx)).rejects.toThrow('DISPOSABLE_REMOTE_TEST_NOT_APPROVED');
  });
  it('UNKNOWN and production authority requests fail', async () => { const authority = new DisposableApprovalAuthority(new FakeControlPlaneObserver({})); const ctx = { ...context(), session: createApprovalSession('REMOTE_TRANSPORT'), transportOrigin: 'REMOTE_TRANSPORT' as const }; await expect(authority.authorize(ctx)).rejects.toThrow('DISPOSABLE_REMOTE_TEST_NOT_APPROVED'); await expect(authority.authorize({ ...ctx, policy: { ...ctx.policy, purpose: 'PRODUCTION_T07' } })).rejects.toThrow(); });
});
function replies(p: TargetPolicy, overrides: Record<string, unknown> = {}) {
  return new FakeControlPlaneHttp(async path => {
    if (path in overrides) return overrides[path];
    const account = `/client/v4/accounts/${p.expectedAccountId}`;
    let result: unknown;
    if (path === account) result = { id: p.expectedAccountId };
    else if (path === `${account}/d1/database/${p.expectedDatabaseId}`) result = { uuid: p.expectedDatabaseId, name: p.expectedName };
    else if (path.includes('/time_travel/bookmark')) result = { bookmark: 'synthetic-bookmark' };
    else if (path.endsWith('/tokens/verify')) result = { id: '1'.repeat(32), status: 'active' };
    else if (path.endsWith('/tokens/' + '1'.repeat(32))) result = { id: '1'.repeat(32), policies: [{ effect: 'allow', resources: { [`com.cloudflare.api.account.${p.expectedAccountId}`]: '*' }, permission_groups: [{ name: 'D1 Write' }] }] };
    else if (path.includes('/workers/scripts?') || path.startsWith('/client/v4/zones?')) return { success: true, result: [], result_info: { page: 1, total_pages: 1 } };
    else throw new Error('SYNTHETIC_PATH_UNEXPECTED');
    return { success: true, result };
  });
}
describe('Actual control-plane observer implementation with fake HTTP', () => {
  it('parses account/database identity but mock results cannot become remote authority', async () => {
    const p = policy(), observer = new CloudflareControlPlaneObserver(p, replies(p)); const account = await observer.observeAccount(), db = await observer.observeDatabase();
    expect(readControlPlaneValue(account)?.accountId === p.expectedAccountId).toBe(true); expect(readControlPlaneValue(db)?.databaseId === p.expectedDatabaseId).toBe(true); expect(readRemoteControlPlaneValue(db)).toBeUndefined(); expect(await controlPlanePrecheck(observer, p)).toBe(false);
    expect(readRemoteControlPlaneValue({ ...db } as never)).toBeUndefined();
  });
  it('reads writer inventory, bookmark and permission policy without treating unknown capabilities as approved', async () => {
    const p = policy(), observer = new CloudflareControlPlaneObserver(p, replies(p)); const writer = readControlPlaneValue(await observer.observeDeploymentWriters())!, recovery = readControlPlaneValue(await observer.observeRecoveryPermissions())!, verification = readControlPlaneValue(await observer.observeVerificationCapability())!;
    expect(writer.workerDeployment).toBe(false); expect(writer.routes).toBe(false); expect(writer.scheduledWriters).toBe(false); expect(writer.otherBindings).toBe('UNKNOWN'); expect(recovery.bookmarkReadable).toBe(true); expect(recovery.restorePermission).toBe(true); expect(recovery.retentionDays).toBe('UNKNOWN'); expect(verification.attackTests).toBe('UNKNOWN');
  });
  it.each(['account', 'database', 'name', 'failed response', 'missing pagination'] as const)('malformed observation %s becomes UNKNOWN', async kind => {
    const p = policy(), a = `/client/v4/accounts/${p.expectedAccountId}`; const overrides: Record<string, unknown> = {};
    if (kind === 'account') overrides[a] = { success: true, result: { id: 'wrong' } };
    if (kind === 'database' || kind === 'name') overrides[`${a}/d1/database/${p.expectedDatabaseId}`] = { success: true, result: { uuid: kind === 'database' ? crypto.randomUUID() : p.expectedDatabaseId, name: kind === 'name' ? 'wrong' : p.expectedName } };
    if (kind === 'failed response') overrides[a] = { success: false, result: {} };
    if (kind === 'missing pagination') overrides[`${a}/workers/scripts?page=1&per_page=100`] = { success: true, result: [] };
    const observer = new CloudflareControlPlaneObserver(p, replies(p, overrides)); const value = kind === 'missing pagination' ? await observer.observeDeploymentWriters() : kind === 'database' || kind === 'name' ? await observer.observeDatabase() : await observer.observeAccount(); expect(value.state).toBe('UNKNOWN');
  });
  it('production observer construction fails before HTTP', () => { const p = policy(); expect(() => new CloudflareControlPlaneObserver({ ...p, purpose: 'PRODUCTION_T07' }, replies(p))).toThrow('DISPOSABLE_TARGET_REQUIRED'); });
  it('real HTTP construction and denied production-path access perform no fetch', async () => { const p = policy(), credential = vi.fn(async () => { throw new Error('MUST_NOT_READ_CREDENTIAL'); }); const http = new CloudflareReadonlyHttp(p, credential); new CloudflareControlPlaneObserver(p, http); await expect(http.get(`/client/v4/accounts/${p.expectedAccountId}/d1/database/${crypto.randomUUID()}`)).rejects.toThrow('CONTROL_PLANE_PATH_DENIED'); expect(credential).not.toHaveBeenCalled(); expect(network).toEqual({ fetch: 0, socket: 0 }); });
});
