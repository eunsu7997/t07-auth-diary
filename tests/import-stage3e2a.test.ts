import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { Socket } from 'node:net';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { LocalImportDatabase, FakeLoopbackAuthAdapter } from '../scripts/stage3d/adapters.ts';
import { LocalD1FixtureProvider, D1PreparationAdapter, FakeLoopbackOwnerBootstrap } from '../scripts/stage3e1/d1-adapter.ts';
import { FakeRemoteSafetyObserver, observeSafety, readObservation as readOldObservation } from '../scripts/stage3e1/safety.ts';
import { prepareDisposablePlan } from '../scripts/stage3e1/prepare-plan.ts';
import { encoded } from './stage3d-fixtures.ts';
import { loadBytes, tables, contract } from '../scripts/stage3d/source.ts';
import { FakeCloudflareD1Transport, WranglerDisposableTransport, type FakeTransportFixture, type TargetPolicy, type Identity } from '../scripts/stage3e2a/transport.ts';
import { DisposableRemoteD1Provider, normalizeD1Error, normalizeD1Result, convertPlan } from '../scripts/stage3e2a/provider.ts';
import { DisposableRemoteObserver, remoteEligible, testOnlyPass, readObservation, type Observation } from '../scripts/stage3e2a/observer.ts';
import { FakeControlPlaneObserver } from '../scripts/stage3e2a/control-plane.ts';
const policy = (): TargetPolicy => ({ purpose: 'DISPOSABLE_TEST', expectedDatabaseId: crypto.randomUUID(), expectedAccountId: crypto.randomUUID().replace(/-/g, ''), expectedName: 'aleph-t07-disposable-fixture', deniedDatabaseIds: [crypto.randomUUID()], explicitConfirmation: true });
const fixture = (p: TargetPolicy): FakeTransportFixture => ({ identity: { purpose: p.purpose, accountId: p.expectedAccountId, databaseId: p.expectedDatabaseId, name: p.expectedName }, writers: { workerDeployment: false, routes: false, scheduledWriters: false, otherBindings: false }, recovery: { timeTravelAvailable: true, retentionDays: 7, bookmarkReadable: true, restorePermission: true }, verification: { read: true, review: true, export: true, attackTests: true }, bookmark: 'synthetic-fixture-bookmark' });
let db: LocalImportDatabase; let p: TargetPolicy; let data: FakeTransportFixture; let adapter: D1PreparationAdapter; let database: Awaited<ReturnType<LocalD1FixtureProvider['getDatabase']>>;
const owner = { id: 'stage3d-fixture-owner', email: 'stage3d@example.invalid' };
it.each(['missing applied 0006', 'active deletion marker'])('0006 observer rejects %s', async fault => {
  const expected = await adapter.inspectSchema();
  if (fault === 'missing applied 0006') db.local.sqlite.exec("DELETE FROM d1_migrations WHERE name='0006_account_deletion.sql'");
  else {
    const bootstrap = new FakeLoopbackAuthAdapter(db); await bootstrap.signup(); await bootstrap.logout();
    db.local.sqlite.prepare('INSERT INTO _account_deletion_scope VALUES(?)').run(owner.id);
  }
  const { observer } = await connected();
  const result = await observer.schema(expected.schemaFingerprint, expected.triggerFingerprint);
  expect(testOnlyPass(result)).toBe(false); expect(remoteEligible(result)).toBe(false);
});
let network = { fetch: 0, socket: 0 };
let fetchSpy: ReturnType<typeof vi.spyOn>; let socketSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { network.fetch++; throw new Error('NETWORK_FORBIDDEN'); });
  socketSpy = vi.spyOn(Socket.prototype, 'connect').mockImplementation(function () { network.socket++; throw new Error('NETWORK_FORBIDDEN'); } as never);
});
afterAll(() => {
  fetchSpy.mockRestore(); socketSpy.mockRestore();
  mkdirSync('evidence/t07/stage3e2a', { recursive: true });
  writeFileSync('evidence/t07/stage3e2a/network-observation.json', JSON.stringify({ scope: 'Stage3E2A test hooks including fresh module import, constructors, blocked real connect, fake transport queries/batches', ...network, cloudflare: 0, preview: 0, remoteD1: 0, deploy: 0, actualSignup: 0, actualImport: 0, limitation: 'Counters cover test execution, not build child-process pipes. Fake memory SQLite is not remote activity.' }, null, 2) + '\n');
});
beforeEach(async () => {
  db = new LocalImportDatabase(); const local = new LocalD1FixtureProvider(db); database = await local.getDatabase(); adapter = await D1PreparationAdapter.fromFixture(local);
  p = policy(); data = fixture(p);
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });
const transport = (f = data) => new FakeCloudflareD1Transport(f, { query: async s => database.prepare(s.sql).bind(...s.params).all(), batch: async s => database.batch(s.map(v => database.prepare(v.sql).bind(...v.params))) });
const connected = async (f = data) => { const provider = new DisposableRemoteD1Provider(p, transport(f)); await provider.connect(); return { provider, observer: new DisposableRemoteObserver(provider) }; };
describe('Stage3E2A provider and target', () => {
  it('fresh import and constructors have no network activity', async () => {
    vi.resetModules(); const t = await import('../scripts/stage3e2a/transport.ts'); const v = await import('../scripts/stage3e2a/provider.ts');
    new v.DisposableRemoteD1Provider(p, new t.WranglerDisposableTransport('unused/disposable-proxy.json'));
    expect(network).toEqual({ fetch: 0, socket: 0 });
  });
  it('refuses query and database before connect and observations stay UNKNOWN', async () => {
    const provider = new DisposableRemoteD1Provider(p, transport());
    await expect(provider.getDatabase()).rejects.toThrow('PROVIDER_NOT_CONNECTED');
    await expect(provider.readObservationQuery('PROXY')).rejects.toThrow('PROVIDER_NOT_CONNECTED');
    const o = new DisposableRemoteObserver(provider);
    expect((await o.identity()).state).toBe('UNKNOWN'); expect((await o.writers()).state).toBe('UNKNOWN'); expect((await o.recovery()).state).toBe('UNKNOWN'); expect((await o.authBootstrap(owner)).state).toBe('UNKNOWN');
  });
  it.each(['production', 'unknown id', 'unknown account', 'empty denylist', 'missing denylist', 'malformed denylist', 'denied', 'name', 'confirmation'] as const)('rejects target %s', kind => {
    if (kind === 'production') p = { ...p, purpose: 'PRODUCTION_T07' };
    if (kind === 'unknown id') p = { ...p, expectedDatabaseId: 'UNKNOWN' };
    if (kind === 'unknown account') p = { ...p, expectedAccountId: '' };
    if (kind === 'empty denylist') p = { ...p, deniedDatabaseIds: [] };
    if (kind === 'missing denylist') p = { ...p, deniedDatabaseIds: undefined as never };
    if (kind === 'malformed denylist') p = { ...p, deniedDatabaseIds: ['bad'] };
    if (kind === 'denied') p = { ...p, deniedDatabaseIds: [p.expectedDatabaseId.toUpperCase()] };
    if (kind === 'name') p = { ...p, expectedName: 'aleph-t07-auth-diary-db' };
    if (kind === 'confirmation') p = { ...p, explicitConfirmation: false };
    expect(() => new DisposableRemoteD1Provider(p, transport())).toThrow();
  });
  it.each(['database', 'account', 'purpose', 'name', 'unknown'] as const)('rejects observed mismatch %s', async kind => {
    if (kind === 'database') data.identity!.databaseId = crypto.randomUUID();
    if (kind === 'account') data.identity!.accountId = crypto.randomUUID().replace(/-/g, '');
    if (kind === 'purpose') data.identity!.purpose = 'PRODUCTION_T07';
    if (kind === 'name') data.identity!.name = 'unexpected';
    if (kind === 'unknown') data.identity = undefined;
    const provider = new DisposableRemoteD1Provider(p, transport());
    await expect(provider.connect()).rejects.toThrow('PROVIDER_CONNECT_REJECTED'); expect(provider.connected).toBe(false);
  });
  it('normalizes IDs without mutating caller policy', async () => {
    p = { ...p, expectedAccountId: ' ' + p.expectedAccountId.toUpperCase() + ' ', expectedDatabaseId: ' ' + p.expectedDatabaseId.toUpperCase() + ' ' };
    const { provider } = await connected(); expect(provider.connected).toBe(true);
  });
  it('untrusted transport object cannot issue observations', () => { expect(() => new DisposableRemoteD1Provider(p, { ...transport() } as never)).toThrow('TRANSPORT_UNTRUSTED'); });
  it('caller cannot replace provider/real transport methods or spoof connection state', () => {
    const real = new WranglerDisposableTransport('unused/disposable-proxy.json'); const provider = new DisposableRemoteD1Provider(p, real);
    expect(() => Object.defineProperty(provider, 'connected', { value: true })).toThrow();
    expect(() => Object.defineProperty(provider, 'info', { value: async () => data.identity })).toThrow();
    expect(() => Object.defineProperty(real, 'connect', { value: async () => undefined })).toThrow();
    expect(() => Object.defineProperty(DisposableRemoteD1Provider.prototype, 'info', { value: async () => data.identity })).toThrow();
  });
  it('real connect remains locked even with approval-shaped input and env flags', async () => {
    vi.stubEnv('DISPOSABLE_EXECUTION_APPROVED', 'true'); vi.stubEnv('CLOUDFLARE_REMOTE', 'true');
    const provider = new DisposableRemoteD1Provider(p, new WranglerDisposableTransport('unused/disposable-proxy.json'));
    await expect(provider.connect({ approved: true })).rejects.toThrow('PROVIDER_CONNECT_REJECTED');
    expect(network).toEqual({ fetch: 0, socket: 0 });
  });
  it('execute without real approval always refuses including fake test transports', async () => {
    const { provider } = await connected(); await expect(provider.execute([], { approved: true })).rejects.toThrow('DISPOSABLE_REMOTE_TEST_NOT_APPROVED');
  });
  it('disconnect invalidates observations and retained database handles', async () => {
    const { provider, observer } = await connected(); const observation = await observer.identity(); const handle = await provider.getDatabase();
    await provider.disconnect(); expect(readObservation(observation)).toBeUndefined(); await expect(handle.prepare('SELECT 1').all()).rejects.toThrow('PROVIDER_NOT_CONNECTED');
  });
});
describe('Stage3E2A observations', () => {
  it('valid fake identity is immutable test-only PASS and cannot satisfy old remote brand', async () => {
    const { observer } = await connected(); const value = await observer.identity();
    expect(testOnlyPass(value)).toBe(true); expect(remoteEligible(value)).toBe(false); expect(Object.isFrozen(value)).toBe(true);
    const inner = readObservation(value)!; expect(Object.isFrozen(inner)).toBe(true);
    expect(readOldObservation(value as never)).toBeUndefined();
  });
  it.each(['forged', 'copied', 'LOCAL_SIMULATION', 'FAKE_TEST', 'UNKNOWN'] as const)('rejects remote eligibility %s', async kind => {
    const { observer } = await connected(); const original = await observer.identity();
    const value = (kind === 'copied' ? { ...original } : { provenance: kind === 'forged' ? 'REMOTE_OBSERVED' : kind, state: 'PASS', observedAt: Date.now(), value: data.identity }) as Observation<Identity>;
    expect(readObservation(value)).toBeUndefined(); expect(remoteEligible(value)).toBe(false);
  });
  it('schema registry fingerprints seventeen triggers counts and FK are independently queried', async () => {
    const expected = await adapter.inspectSchema(); const { observer } = await connected();
    const value = await observer.schema(expected.schemaFingerprint, expected.triggerFingerprint);
    expect(testOnlyPass(value)).toBe(true); const metadata = readObservation(value)!;
    expect(metadata.migrations).toHaveLength(6); expect(metadata.triggerCount).toBe(17); expect(metadata.fkClean).toBe(true); expect(metadata.fkEnabled).toBe(true);
    expect(Object.keys(metadata.counts)).toHaveLength(tables.length + 6);
    expect(metadata.counts._account_deletion_scope).toBe(0);
    expect(testOnlyPass(await observer.schema('wrong', expected.triggerFingerprint))).toBe(false);
  });
  it.each(['workerDeployment', 'routes', 'scheduledWriters', 'otherBindings'] as const)('writer %s UNKNOWN fails closed', async field => {
    data.writers[field] = 'UNKNOWN'; const { observer } = await connected(); const result = await observer.writers(); expect(result.state).toBe('UNKNOWN'); expect(remoteEligible(result)).toBe(false);
  });
  it.each(['workerDeployment', 'routes', 'scheduledWriters', 'otherBindings'] as const)('writer %s present FAIL', async field => {
    data.writers[field] = true; const { observer } = await connected(); expect((await observer.writers()).state).toBe('FAIL');
  });
  it('no writer and zero active sessions passes only in test', async () => { const { observer } = await connected(); expect(testOnlyPass(await observer.writers())).toBe(true); });
  it.each(['timeTravelAvailable', 'retentionDays', 'bookmarkReadable', 'restorePermission'] as const)('recovery %s UNKNOWN fails closed', async field => {
    data.recovery[field] = 'UNKNOWN'; const { observer } = await connected(); const result = await observer.recovery(); expect(result.state).toBe('UNKNOWN'); expect(remoteEligible(result)).toBe(false);
  });
  it('recovery capability all confirmed is test-only PASS', async () => { const { observer } = await connected(); expect(testOnlyPass(await observer.recovery())).toBe(true); });
  it.each(['permission', 'bookmark', 'retention'] as const)('recovery %s failure FAIL', async kind => {
    if (kind === 'permission') data.recovery.restorePermission = false;
    if (kind === 'bookmark') data.bookmark = undefined;
    if (kind === 'retention') data.recovery.retentionDays = 1;
    const { observer } = await connected(); expect((await observer.recovery()).state).toBe('FAIL');
  });
  it('verification and proxy are test-only PASS', async () => { const { observer } = await connected(); expect(testOnlyPass(await observer.verification())).toBe(true); expect(testOnlyPass(await observer.proxy())).toBe(true); });
  it('verification UNKNOWN cannot be replaced by human approval', async () => { data.verification.attackTests = 'UNKNOWN'; const { observer } = await connected(); expect((await observer.verification()).state).toBe('UNKNOWN'); });
  it('auth bootstrap queries exact owner credential relations session zero and rate baseline without signup', async () => {
    // Synthetic local database setup only; no Better Auth signup or remote account.
    const auth = new FakeLoopbackAuthAdapter(db); await auth.signup(); await auth.logout();
    const { observer } = await connected(); await observer.captureLogoutBaseline(owner); const value = await observer.authBootstrap(owner);
    expect(testOnlyPass(value)).toBe(true); expect(remoteEligible(value)).toBe(false);
    expect(readObservation(value)?.expectedMaskedEmailMatch).toBe(true);
    expect((await observer.authBootstrap({ ...owner, email: 'wrong@example.invalid' })).state).toBe('FAIL');
  });
  it('empty auth database fails and cannot mint approved baseline', async () => { const { observer } = await connected(); expect((await observer.authBootstrap(owner)).state).toBe('FAIL'); });
});
describe('Stage3E2A D1 batch preparation', () => {
  it('Stage3E1 plan converts without losing any field and executes only fake memory D1', async () => {
    const auth = new FakeLoopbackAuthAdapter(db); const bootstrap = new FakeLoopbackOwnerBootstrap(adapter, owner, auth); await bootstrap.signup(); await bootstrap.logout();
    const bytes = encoded(); const source = loadBytes(bytes.bytes, bytes.sha); const expected = await adapter.inspectSchema();
    const observations = await observeSafety(new FakeRemoteSafetyObserver({ target: { accountId: p.expectedAccountId, databaseId: p.expectedDatabaseId, purpose: 'disposable' } }));
    const plan = await prepareDisposablePlan(source, adapter, { target: { expectedDatabaseId: p.expectedDatabaseId, expectedAccountId: p.expectedAccountId, deniedDatabaseIds: p.deniedDatabaseIds, explicitConfirmation: true, targetObserved: observations.target }, observations, owner, sourceSha: source.sha, sourceCounts: source.counts, expectedSchema: expected.schema, rateBaseline: (await bootstrap.inspectOwner()).rateLimitBaselineSummary, approvalChecks: {} });
    const converted = convertPlan(plan.statements); expect(converted).toEqual(plan.statements); expect(Object.isFrozen(converted[0].params)).toBe(true);
    const { provider } = await connected(); const handle = await provider.getDatabase();
    await handle.batch(converted.map(s => handle.prepare(s.sql).bind(...s.params)));
    for (const table of tables) {
      const fields = Object.keys(contract.$defs[table].properties);
      const actual = db.local.sqlite.prepare(`SELECT ${fields.join(',')} FROM ${table}`).all();
      const canonical = (rows: Record<string, unknown>[]) => rows.map(r => JSON.stringify(fields.map(f => r[f]))).sort();
      expect(canonical(actual)).toEqual(canonical(source.data[table]));
    }
  });
  it.each([{}, { success: false, results: [] }, { success: true, results: null }])('normalizes malformed D1 response %j', value => { expect(() => normalizeD1Result(value)).toThrow('D1_RESULT_INVALID'); });
  it('D1 error normalization never exposes raw SQL or bound values', () => { expect(normalizeD1Error(new Error('synthetic private payload')).message).toBe('D1_OPERATION_FAILED'); });
  it('batch failure rolls back and returns only normalized error', async () => {
    const { provider } = await connected(); const handle = await provider.getDatabase();
    await expect(handle.batch([handle.prepare("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('synthetic','test','test@example.invalid',0,0,0)"), handle.prepare("SELECT json_extract('not-json','$')")])).rejects.toThrow('D1_OPERATION_FAILED');
    expect(db.local.sqlite.prepare('SELECT count(*) AS n FROM user').get()?.n).toBe(0);
  });
  it('rejects unsupported SQL before transport submission', () => { expect(() => convertPlan([{ sql: 'DROP TRIGGER example', params: [] }])).toThrow('D1_STATEMENT_INVALID'); });
  it('cannot use read to submit writes', async () => { const { provider } = await connected(); await expect(provider.readObservationQuery('DELETE FROM user' as never)).rejects.toThrow('OBSERVATION_QUERY_INVALID'); });
});

describe('Stage3E2A repair', () => {
  it('concurrent connect allows exactly one winner', async () => {
    const provider = new DisposableRemoteD1Provider(p, transport());
    const first = provider.connect(); expect(provider.state).toBe('CONNECTING');
    const result = await Promise.allSettled([first, provider.connect()]);
    expect(result.filter(v => v.status === 'fulfilled')).toHaveLength(1); expect(result.filter(v => v.status === 'rejected')).toHaveLength(1); expect(provider.state).toBe('CONNECTED');
  });
  it('connected connect and closed reconnect are rejected permanently', async () => {
    const { provider } = await connected(); await expect(provider.connect()).rejects.toThrow('PROVIDER_STATE_INVALID');
    await provider.disconnect(); expect(provider.state).toBe('CLOSED'); await expect(provider.connect()).rejects.toThrow('PROVIDER_STATE_INVALID');
  });
  it('failed connect is terminal', async () => {
    data.identity = undefined; const provider = new DisposableRemoteD1Provider(p, transport());
    await expect(provider.connect()).rejects.toThrow('PROVIDER_CONNECT_REJECTED'); expect(provider.state).toBe('CLOSED'); await expect(provider.connect()).rejects.toThrow('PROVIDER_STATE_INVALID');
  });
  it('disconnect during CONNECTING cannot resurrect connection', async () => {
    const provider = new DisposableRemoteD1Provider(p, transport()); const attempt = provider.connect(); const rejected = expect(attempt).rejects.toThrow('PROVIDER_CONNECT_REJECTED');
    await provider.disconnect(); await rejected; expect(provider.state).toBe('CLOSED');
  });
  it('CLOSED blocks fixed reads info and retained batch handles', async () => {
    const { provider } = await connected(); const handle = await provider.getDatabase(); await provider.disconnect();
    await expect(provider.readObservationQuery('PROXY')).rejects.toThrow('PROVIDER_NOT_CONNECTED'); await expect(provider.info()).rejects.toThrow('PROVIDER_NOT_CONNECTED'); await expect(handle.batch([])).rejects.toThrow('PROVIDER_NOT_CONNECTED');
  });
  it('old session observation never reactivates with a new provider connection', async () => {
    const first = await connected(); const old = await first.observer.identity(); await first.provider.disconnect();
    const second = await connected(); expect(testOnlyPass(await second.observer.identity())).toBe(true); expect(readObservation(old)).toBeUndefined(); await expect(first.provider.connect()).rejects.toThrow('PROVIDER_STATE_INVALID');
  });
  it('transport termination invalidates its provider session and observations', async () => {
    const t = transport(); const provider = new DisposableRemoteD1Provider(p, t); await provider.connect(); const observer = new DisposableRemoteObserver(provider); const old = await observer.identity();
    await t.disconnect(); expect(readObservation(old)).toBeUndefined(); expect(provider.state).toBe('CLOSED'); await expect(provider.connect()).rejects.toThrow('PROVIDER_STATE_INVALID');
  });
  it('approved fixed query passes and results exclude injected sensitive fields', async () => {
    const t = new FakeCloudflareD1Transport(data, { query: async () => ({ success: true, results: [{ proxy_ok: 1, password: 'synthetic-only-value' }] }), batch: async () => [] });
    const provider = new DisposableRemoteD1Provider(p, t); await provider.connect(); expect(await provider.readObservationQuery('PROXY')).toEqual([{ proxy_ok: 1 }]);
  });
  it('fixed query result rejects nested payloads instead of exposing extra sensitive data', async () => {
    const t = new FakeCloudflareD1Transport(data, { query: async () => ({ success: true, results: [{ proxy_ok: { password: 'synthetic-only-value' } }] }), batch: async () => [] });
    const provider = new DisposableRemoteD1Provider(p, t); await provider.connect(); await expect(provider.readObservationQuery('PROXY')).rejects.toThrow('D1_OPERATION_FAILED');
  });
  it('batch results expose success only even if fake transport supplies sensitive payload', async () => {
    const t = new FakeCloudflareD1Transport(data, { query: async () => ({ success: true, results: [] }), batch: async () => [{ success: true, results: [{ password: 'synthetic-only-value' }] }] });
    const provider = new DisposableRemoteD1Provider(p, t); await provider.connect(); const handle = await provider.getDatabase();
    expect(await handle.batch([handle.prepare('SELECT 1 AS proxy_ok')])).toEqual([{ success: true, results: [] }]);
  });
  it.each(['SELECT password FROM account', 'SELECT * FROM account', 'SELECT * FROM user', 'SELECT credential FROM account', 'SELECT 42', 'PRAGMA database_list'] as const)('query registry rejects %s', async sql => {
    const { provider } = await connected(); await expect(provider.readObservationQuery(sql as never)).rejects.toThrow('OBSERVATION_QUERY_INVALID'); const handle = await provider.getDatabase(); await expect(handle.prepare(sql).all()).rejects.toThrow('OBSERVATION_QUERY_INVALID');
  });
  it('bigint bind rejects before JSON measurement with a fixed error', () => {
    expect(() => convertPlan([{ sql: 'SELECT ?', params: [1n] as never }])).toThrow('D1_STATEMENT_INVALID');
  });
  it('transport origin is distinct from observation provenance before connection', () => {
    const provider = new DisposableRemoteD1Provider(p, new WranglerDisposableTransport('unused/disposable-proxy.json')); expect(provider.transportOrigin).toBe('REMOTE_TRANSPORT'); expect('provenance' in provider).toBe(false);
  });
  it.each([11, 60])('stored logout baseline passes unchanged after %i minutes without recapture', async minutes => {
    const auth = new FakeLoopbackAuthAdapter(db); await auth.signup(); await auth.logout();
    const now = Date.now(); db.local.sqlite.prepare('INSERT INTO rateLimit(id,key,count,lastRequest) VALUES(?,?,?,?)').run('repair-rate', 'no-trusted-ip|/sign-up/email', 1, now);
    const { observer } = await connected(); const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try { await observer.captureLogoutBaseline(owner); clock.mockReturnValue(now + minutes * 60000); expect(testOnlyPass(await observer.authBootstrap(owner))).toBe(true); await expect(observer.captureLogoutBaseline(owner)).rejects.toThrow('RATE_REBASELINE_FORBIDDEN'); }
    finally { clock.mockRestore(); }
  });
  it.each(['add', 'delete', 'key', 'count', 'timestamp'] as const)('60 minute stored baseline detects %s mutation', async mutation => {
    const auth = new FakeLoopbackAuthAdapter(db); await auth.signup(); await auth.logout(); const now = Date.now();
    db.local.sqlite.prepare('INSERT INTO rateLimit(id,key,count,lastRequest) VALUES(?,?,?,?)').run('repair-rate', 'no-trusted-ip|/sign-up/email', 1, now);
    const { provider, observer } = await connected(); const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      await observer.captureLogoutBaseline(owner); clock.mockReturnValue(now + 60 * 60000);
      if (mutation === 'add') db.local.sqlite.prepare('INSERT INTO rateLimit(id,key,count,lastRequest) VALUES(?,?,?,?)').run('added', 'no-trusted-ip|/sign-out', 1, now);
      if (mutation === 'delete') db.local.sqlite.exec('DELETE FROM rateLimit');
      if (mutation === 'key') db.local.sqlite.exec("UPDATE rateLimit SET key='no-trusted-ip|/sign-in/email'");
      if (mutation === 'count') db.local.sqlite.exec('UPDATE rateLimit SET count=2');
      if (mutation === 'timestamp') db.local.sqlite.exec('UPDATE rateLimit SET lastRequest=lastRequest+1');
      expect((await observer.authBootstrap(owner)).state).toBe('FAIL');
      await expect(new DisposableRemoteObserver(provider).captureLogoutBaseline(owner)).rejects.toThrow('RATE_REBASELINE_FORBIDDEN');
    } finally { clock.mockRestore(); }
  });
  it('auth observation without explicit logout capture stays UNKNOWN', async () => {
    const auth = new FakeLoopbackAuthAdapter(db); await auth.signup(); await auth.logout(); const { observer } = await connected(); expect((await observer.authBootstrap(owner)).state).toBe('UNKNOWN');
  });
  it.each(['UNKNOWN', 'fake', 'approval-shaped'] as const)('control-plane %s opens no actual proxy', async kind => {
    const control = kind === 'UNKNOWN' ? new FakeControlPlaneObserver({}) : new FakeControlPlaneObserver({ identity: data.identity, writers: data.writers, recovery: data.recovery });
    const real = new WranglerDisposableTransport('unused/disposable-proxy.json', control);
    await expect(real.connect(p, kind === 'approval-shaped' ? Object.freeze({ approved: true }) : undefined)).rejects.toThrow('CONTROL_PLANE_UNKNOWN'); expect(network).toEqual({ fetch: 0, socket: 0 });
  });
  it.each(['missing', 'forged', 'copied', 'reused'] as const)('approval %s cannot authorize execute', async kind => {
    const { provider } = await connected(); const original = Object.freeze({ kind: 'DisposableExecutionApproval', expiresAt: Date.now() + 100000, action: 'BATCH' }); const approval = kind === 'missing' ? undefined : kind === 'copied' ? { ...original } : original;
    await expect(provider.execute([], approval)).rejects.toThrow('DISPOSABLE_REMOTE_TEST_NOT_APPROVED'); if (kind === 'reused') await expect(provider.execute([], approval)).rejects.toThrow('DISPOSABLE_REMOTE_TEST_NOT_APPROVED');
  });
  it('automatic production protection denies repository bindings even if caller denylist omits them', () => {
    const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    const protectedId = [...config.matchAll(/"database_id"\s*:\s*"([^"]+)"/g)][0][1];
    expect(() => new DisposableRemoteD1Provider({ ...p, expectedDatabaseId: protectedId }, transport())).toThrow('TARGET_DENIED');
  });
  it('missing production binding file fails closed without logging its contents', async () => {
    vi.resetModules();
    vi.doMock('node:fs', async importOriginal => {
      const fs = await importOriginal<typeof import('node:fs')>();
      return { ...fs, readFileSync: (...args: Parameters<typeof fs.readFileSync>) => { if (String(args[0]).includes('wrangler.jsonc')) throw new Error('synthetic read failure'); return fs.readFileSync(...args); } };
    });
    try { const fresh = await import('../scripts/stage3e2a/transport.ts'); expect(() => fresh.normalizeTarget(p)).toThrow('PRODUCTION_PROTECTION_UNKNOWN'); }
    finally { vi.doUnmock('node:fs'); vi.resetModules(); }
  });
});
