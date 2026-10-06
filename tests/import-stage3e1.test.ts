import { beforeEach, afterEach, beforeAll, afterAll, expect, it, vi, describe } from 'vitest';
import { Socket } from 'node:net';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { LocalImportDatabase, FakeLoopbackAuthAdapter, trustedBaseline } from '../scripts/stage3d/adapters.ts';
import { loadBytes, digest, tables } from '../scripts/stage3d/source.ts';
import { encoded } from './stage3d-fixtures.ts';
import { FakeRemoteSafetyObserver, LocalSafetyObserver, observeSafety, checkTarget, checkRateBaseline, captureRateBaseline, unknown, observedChecks, recoveryMeaning, remoteFactsEligible, RATE_BASELINE_LIMITS, type RateRow, type ObserverFixture } from '../scripts/stage3e1/safety.ts';
import { CloudflareD1Provider, LocalD1FixtureProvider, D1PreparationAdapter, FakeLoopbackOwnerBootstrap, normalizeSql, schemaFingerprint, migrationRegistry, remoteBootstrapEligible } from '../scripts/stage3e1/d1-adapter.ts';
import { preparedPreflight, prepareDisposablePlan, executeRemoteTest, detectUnsupportedSql, type PreparationPolicy } from '../scripts/stage3e1/prepare-plan.ts';
let db: LocalImportDatabase; let adapter: D1PreparationAdapter; let bootstrap: FakeLoopbackOwnerBootstrap; let policy: PreparationPolicy;
const owner = { id: 'stage3d-fixture-owner', email: 'stage3d@example.invalid' };
const f = encoded(); const source = loadBytes(f.bytes, f.sha);
const FIXTURE_DATABASE_ID = crypto.randomUUID();
const FIXTURE_ACCOUNT_ID = crypto.randomUUID().replace(/-/g, '');
const FIXTURE_DENIED_DATABASE_ID = crypto.randomUUID();
const fixture = (): ObserverFixture => ({ target: { accountId: FIXTURE_ACCOUNT_ID, databaseId: FIXTURE_DATABASE_ID, purpose: 'disposable' },
  writers: { productionWorkerExists: false, routesExist: false, otherBindingsExist: false, scheduledWritersExist: false, activeSessions: 0, externalWriterCheck: true },
  recovery: { available: true, retentionDays: 7, canReadBookmark: true, canRestore: true }, verification: { read: true, review: true, export: true, attackTests: true }, leakSafe: true, proxyAllowed: true });
const snapshot = () => digest(JSON.stringify(['user', 'account', 'session', 'verification', 'rateLimit', ...tables].map(t => db.local.sqlite.prepare(`SELECT * FROM "${t}"`).all())));
const network = { fetchCalls: 0, socketConnects: 0 };
let fetchSpy: ReturnType<typeof vi.spyOn>; let socketSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { network.fetchCalls++; throw new Error('NETWORK_FORBIDDEN'); });
  socketSpy = vi.spyOn(Socket.prototype, 'connect').mockImplementation(function () { network.socketConnects++; throw new Error('NETWORK_FORBIDDEN'); } as never);
});
afterAll(() => {
  fetchSpy.mockRestore(); socketSpy.mockRestore();
  mkdirSync('evidence/t07/stage3e1', { recursive: true });
  writeFileSync('evidence/t07/stage3e1/network-observation.json', JSON.stringify({ scope: 'Stage3E-1 execution after test hooks: fresh module import, constructors, fake observations, D1 fixture reads/batches, blocked remote attempts',
    ...network, wranglerRemoteSessions: 0, cloudflareAccountApiRequests: 0, realD1Connections: 0,
    limitation: 'fetch/socket counters instrument test execution only; docs browsing and build tooling are separate. Static module scan also forbids Wrangler imports/remote sessions.' }, null, 2) + '\n');
});
beforeEach(async () => {
  trustedBaseline(); // independently verifies reviewed migration hashes.
  const reference = new LocalImportDatabase();
  let expectedSchema;
  try { const referenceAdapter = await D1PreparationAdapter.fromFixture(new LocalD1FixtureProvider(reference)); expectedSchema = (await referenceAdapter.inspectSchema()).schema; }
  finally { reference.close(); }
  db = new LocalImportDatabase(); const auth = new FakeLoopbackAuthAdapter(db);
  adapter = await D1PreparationAdapter.fromFixture(new LocalD1FixtureProvider(db));
  bootstrap = new FakeLoopbackOwnerBootstrap(adapter, owner, auth); await bootstrap.signup(); await bootstrap.logout();
  const observations = await observeSafety(new FakeRemoteSafetyObserver(fixture()));
  policy = { target: { expectedDatabaseId: FIXTURE_DATABASE_ID, expectedAccountId: FIXTURE_ACCOUNT_ID, deniedDatabaseIds: [FIXTURE_DENIED_DATABASE_ID], explicitConfirmation: true, targetObserved: observations.target },
    observations, owner, sourceSha: source.sha, sourceCounts: source.counts, expectedSchema, rateBaseline: (await bootstrap.inspectOwner()).rateLimitBaselineSummary, approvalChecks: {} };
  policy.ownerBootstrap = await bootstrap.inspectOwner();
});
afterEach(() => db.close());
it.each([0, 1])('observed post-logout rate baseline with %i rows passes without fixed zero', async n => {
  if (n) db.local.sqlite.prepare('INSERT INTO rateLimit VALUES (?,?,?,?)').run('fixture-rate', 'no-trusted-ip|/sign-up/email', 1, Date.now());
  await bootstrap.logout(); policy.rateBaseline = (await bootstrap.inspectOwner()).rateLimitBaselineSummary;
  expect(checkRateBaseline(await adapter.rateRows(), policy.rateBaseline)).toBe('PASS');
  expect((await preparedPreflight(source, adapter, policy)).checks.find(c => c.id === 'P28')?.state).toBe('PASS');
});
it.each(['extra row', 'blank key', 'negative state', 'changed key', 'unknown baseline'] as const)('unexpected rate %s blocks', async kind => {
  if (kind === 'unknown baseline') policy.rateBaseline = { status: 'Unknown' };
  else {
    db.local.sqlite.prepare('INSERT INTO rateLimit VALUES (?,?,?,?)').run('fixture-rate', 'no-trusted-ip|/sign-up/email', 1, Date.now());
    await bootstrap.logout(); policy.rateBaseline = (await bootstrap.inspectOwner()).rateLimitBaselineSummary;
    if (kind === 'extra row') db.local.sqlite.prepare('INSERT INTO rateLimit VALUES (?,?,?,?)').run('fixture-extra', 'no-trusted-ip|/sign-out', 1, Date.now());
    if (kind === 'blank key') db.local.sqlite.exec("UPDATE rateLimit SET key=''");
    if (kind === 'negative state') db.local.sqlite.exec('UPDATE rateLimit SET count=-1');
    if (kind === 'changed key') db.local.sqlite.exec("UPDATE rateLimit SET key='other-fixture-path'");
  }
  const result = await preparedPreflight(source, adapter, policy);
  expect(result.checks.find(c => c.id === 'P28')?.state).not.toBe('PASS'); expect(result.executionApproved).toBe(false);
});
it('baseline before logout or without exact owner stays UNKNOWN', () => {
  expect(captureRateBaseline([], { ownerExact: true, sessions: 1 }).status).toBe('Unknown');
  expect(captureRateBaseline([], { ownerExact: false, sessions: 0 }).status).toBe('Unknown');
  expect(checkRateBaseline([], { status: 'Observed', count: 0, observedAt: Date.now() })).toBe('UNKNOWN');
});
it('local observer leaves Cloudflare facts Unknown and checks local leak configuration', async () => {
  const result = observedChecks(await observeSafety(new LocalSafetyObserver({ debugBindings: false, sourceInArgs: false, sourceInEnv: false, evidenceContainsValues: false })));
  expect(result.writers).toBe('UNKNOWN'); expect(result.recovery).toBe('UNKNOWN'); expect(result.verification).toBe('UNKNOWN'); expect(result.leak).toBe('PASS');
});
it.each(['writers', 'recovery', 'verification', 'proxyAllowed', 'leakSafe'] as const)('observer %s missing cannot become PASS through approval flags', async key => {
  const input = fixture(); delete input[key]; const result = await observeSafety(new FakeRemoteSafetyObserver(input));
  const check = key === 'proxyAllowed' ? 'proxy' : key === 'leakSafe' ? 'leak' : key;
  expect(observedChecks(result)[check]).toBe('UNKNOWN');
});
it('external writer UNKNOWN blocks and forged observation is untrusted', async () => {
  const input = fixture(); input.writers!.routesExist = 'UNKNOWN';
  expect(observedChecks(await observeSafety(new FakeRemoteSafetyObserver(input))).writers).toBe('UNKNOWN');
  expect(checkTarget({ ...policy.target, targetObserved: { status: 'Observed', value: fixture().target!, origin: 'FAKE_TEST', observedAt: Date.now() } }).identity).toBe('UNKNOWN');
});
it('D1 registry fixture and direct small PRAGMA reads exclude local registry/table-valued functions', async () => {
  const schema = await adapter.inspectSchema(); expect(schema.migrations.length).toBe(5);
  expect(migrationRegistry('d1')).toBe('d1_migrations'); expect(migrationRegistry('local')).toBe('_migrations');
  expect(schema.schema.some(r => r.name === '_migrations')).toBe(false);
  expect(adapter.queries.some(q => q === "PRAGMA foreign_key_list('tasks')")).toBe(true);
  expect(adapter.queries.every(q => !/pragma_\w+\s*\(/i.test(q) && !/UNION/i.test(q))).toBe(true);
});
it('schema and trigger fingerprints normalize line endings/formatting/order, preserving literal semantics', async () => {
  const schema = (await adapter.inspectSchema()).schema;
  const formatted = [...schema].reverse().map(r => ({ ...r, sql: r.sql?.replace(/\n/g, '\r\n').replace(/\(/g, ' ( ').replace(/\)/g, ' ) ') ?? null }));
  expect(schemaFingerprint(schema)).toBe(schemaFingerprint(formatted)); expect(schemaFingerprint(schema, true)).toBe(schemaFingerprint(formatted, true));
  expect(normalizeSql("SELECT 'a  b'")).not.toBe(normalizeSql("SELECT 'a b'"));
});
it.each(['target mismatch', 'T06 deny', 'confirmation false', 'expected unknown', 'observation unknown', 'account mismatch', 'production target'] as const)('target policy %s refuses eligibility', async kind => {
  const target = { ...policy.target };
  if (kind === 'target mismatch') target.expectedDatabaseId = 'other';
  if (kind === 'T06 deny') target.deniedDatabaseIds = [FIXTURE_DATABASE_ID];
  if (kind === 'confirmation false') target.explicitConfirmation = false;
  if (kind === 'expected unknown') target.expectedDatabaseId = 'UNKNOWN';
  if (kind === 'observation unknown') target.targetObserved = unknown();
  if (kind === 'account mismatch') target.expectedAccountId = 'other';
  if (kind === 'production target') { const input = fixture(); input.target!.purpose = 'production'; target.targetObserved = (await observeSafety(new FakeRemoteSafetyObserver(input))).target; }
  const result = checkTarget(target); expect(result.identity !== 'PASS' || result.confirmation !== 'PASS').toBe(true);
});
it('prepared D1 candidate uses observed rates and simple task UPDATE, preserving fields/triggers in SQLite', async () => {
  db.local.sqlite.prepare('INSERT INTO rateLimit VALUES (?,?,?,?)').run('fixture-rate', 'no-trusted-ip|/sign-up/email', 1, Date.now()); await bootstrap.logout();
  policy.rateBaseline = (await bootstrap.inspectOwner()).rateLimitBaselineSummary;
  const beforeSchema = await adapter.inspectSchema(); const beforeRates = await adapter.rateRows();
  const plan = await prepareDisposablePlan(source, adapter, policy);
  mkdirSync('evidence/t07/stage3e1', { recursive: true });
  writeFileSync('evidence/t07/stage3e1/disposable-plan-summary.json', JSON.stringify({ scope: 'synthetic fixture candidate only; not executed remotely',
    executionApproved: plan.executionApproved, sourceSha256: plan.sourceSha, generator: plan.metrics, steps: plan.steps,
    unresolvedChecks: plan.unresolvedChecks, forcedFailureStatements: plan.forcedFailureBatch.length,
    targetIdentity: 'UNKNOWN for actual Cloudflare target; opaque synthetic identity used in tests', rateBaseline: 'post-fake-logout captured; keys/values omitted' }, null, 2) + '\n');
  expect(plan.executionApproved).toBe(false); expect(plan.unresolvedChecks.length > 0).toBe(true);
  expect(plan.statements.every(s => !detectUnsupportedSql(s.sql))).toBe(true);
  await adapter.executeFixture(plan.statements);
  const after = await adapter.inspectSchema(); expect(after.triggerFingerprint === beforeSchema.triggerFingerprint && after.fkClean).toBe(true);
  expect(checkRateBaseline(await adapter.rateRows(), policy.rateBaseline)).toBe('PASS'); expect((await adapter.rateRows()).length === beforeRates.length).toBe(true);
  for (const table of tables) {
    const rows = db.local.sqlite.prepare(`SELECT * FROM ${table}`).all();
    const expected = source.data[table].map(r => table === 'plans' || table === 'tags' ? { ...r, owner_user_id: owner.id } : r);
    const canon = (input: unknown[]) => JSON.stringify(input.map(r => Object.fromEntries(Object.entries(r as object).sort())).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    expect(canon(rows) === canon(expected)).toBe(true);
  }
});
it('D1 candidate forced SQL failure rolls back entire fixture without overflow', async () => {
  const before = snapshot(); const schema = await adapter.inspectSchema(); const plan = await prepareDisposablePlan(source, adapter, policy);
  await expect(adapter.executeFixture(plan.forcedFailureBatch)).rejects.toThrow('FIXTURE_BATCH_FAILED');
  expect(snapshot() === before).toBe(true); expect((await adapter.inspectSchema()).triggerFingerprint).toBe(schema.triggerFingerprint);
});
it('in-batch rate guard catches an unexpected row after preparation and rolls back', async () => {
  const plan = await prepareDisposablePlan(source, adapter, policy);
  db.local.sqlite.prepare('INSERT INTO rateLimit VALUES (?,?,?,?)').run('unexpected-rate', 'no-trusted-ip|/sign-out', 1, Date.now()); const before = snapshot();
  await expect(adapter.executeFixture(plan.statements)).rejects.toThrow('FIXTURE_BATCH_FAILED'); expect(snapshot() === before).toBe(true);
});
it.each(['UPDATE tasks SET content=? FROM other', 'SELECT abs(-9223372036854775808)', 'SELECT * FROM pragma_foreign_key_list(?)', 'BEGIN', 'DROP TRIGGER guard'])('unsupported SQL is detected: %s', sql => { expect(detectUnsupportedSql(sql)).toBe(true); });
it.each(['NOT_EXECUTED', 'COMPLETED', 'UNEXPECTED_PARTIAL_OR_UNKNOWN'] as const)('remote recovery meaning %s never retries', outcome => {
  const result = recoveryMeaning(outcome); expect(result.automaticRetry).toBe(false); expect(result.humanInterventionRequired).toBe(outcome !== 'COMPLETED');
});
it('bootstrap reports exact owner relationships, masked match and post-logout rate summary', async () => {
  const result = await bootstrap.inspectOwner(); expect(result.userCount).toBe(1); expect(result.exactUserId).toBe(owner.id); expect(result.expectedMaskedEmailMatch).toBe(true);
  expect(result.accountCount === 1 && result.accountUserId === owner.id && result.accountAccountId === owner.id && result.providerId === 'credential' && result.sessionCount === 0).toBe(true);
  expect(result.maskedEmail).toBe('***@***'); expect(result.rateLimitBaselineSummary.status).toBe('Observed');
});
it('provider import/constructor/unconnected reads and confirmed remote attempt perform no network', async () => {
  const provider = new CloudflareD1Provider('UNKNOWN'); const spy = vi.spyOn(provider, 'getDatabase'); const isolated = new D1PreparationAdapter(provider);
  await expect(isolated.read('SELECT 1')).rejects.toThrow('D1_READ_FAILED');
  await expect(isolated.executeDisposable([], true)).rejects.toThrow('REMOTE_TEST_NOT_APPROVED');
  await expect(executeRemoteTest({}, true)).rejects.toThrow('REMOTE_TEST_NOT_APPROVED'); expect(spy).not.toHaveBeenCalled();
  expect(network.fetchCalls).toBe(0); expect(network.socketConnects).toBe(0);
});
it('new modules cannot import Wrangler or open sockets/fetch', () => {
  for (const name of ['safety.ts', 'd1-adapter.ts', 'prepare-plan.ts']) {
    const code = readFileSync('scripts/stage3e1/' + name, 'utf8');
    expect(/from\s*['"]wrangler['"]|\bgetPlatformProxy\s*\(|\bstartRemoteProxySession\s*\(|\bfetch\s*\(|\bSocket\b/.test(code)).toBe(false);
  }
});
it('fake factory rejects an arbitrary provider before its getDatabase can attempt network', async () => {
  const getDatabase = vi.fn(async () => { await fetch('https://invalid.example'); throw new Error('UNREACHABLE'); });
  await expect(D1PreparationAdapter.fromFixture({ getDatabase } as unknown as LocalD1FixtureProvider)).rejects.toThrow('FIXTURE_PROVIDER_REQUIRED');
  expect(getDatabase).not.toHaveBeenCalled(); expect(network.fetchCalls).toBe(0); expect(network.socketConnects).toBe(0);
});
it('caller PASS cannot override observed UNKNOWN/FAIL in 37-check preparation', async () => {
  policy.observations = await observeSafety(new FakeRemoteSafetyObserver({}));
  policy.approvalChecks = Object.fromEntries(Array.from({ length: 37 }, (_, i) => ['P' + String(i + 1).padStart(2, '0'), { kind: 'HumanApproval' as const, decision: 'APPROVED' as const }]));
  const report = await preparedPreflight(source, adapter, policy);
  for (const id of ['P18', 'P21', 'P29', 'P30', 'P31', 'P32', 'P36']) expect(report.checks.find(c => c.id === id)?.state).toBe('UNKNOWN');
  expect(report.allPass).toBe(false); expect(report.executionApproved).toBe(false);
});
it('fresh module import and constructor under network tripwires have no fetch/socket calls', async () => {
  vi.resetModules(); const fresh = await import('../scripts/stage3e1/d1-adapter.ts');
  const provider = new fresh.CloudflareD1Provider('UNKNOWN'); new fresh.D1PreparationAdapter(provider);
  expect(network.fetchCalls).toBe(0); expect(network.socketConnects).toBe(0);
});
describe('Stage3E1 supplement', () => {
  it.each(['empty expected database', 'blank expected database', 'empty observed database', 'empty expected account', 'empty observed account', 'empty denylist', 'missing denylist', 'blank denylist entry', 'invalid UUID', 'invalid account format'] as const)('target rejects %s', async kind => {
    const target = { ...policy.target }; const input = fixture();
    if (kind === 'empty expected database') target.expectedDatabaseId = '';
    if (kind === 'blank expected database') target.expectedDatabaseId = '  ';
    if (kind === 'empty observed database') input.target!.databaseId = '';
    if (kind === 'empty expected account') target.expectedAccountId = '';
    if (kind === 'empty observed account') input.target!.accountId = '  ';
    if (kind === 'empty denylist') target.deniedDatabaseIds = [];
    if (kind === 'missing denylist') delete (target as Partial<typeof target>).deniedDatabaseIds;
    if (kind === 'blank denylist entry') target.deniedDatabaseIds = ['  '];
    if (kind === 'invalid UUID') target.expectedDatabaseId = 'not-a-uuid';
    if (kind === 'invalid account format') target.expectedAccountId = 'not-an-account';
    target.targetObserved = (await observeSafety(new FakeRemoteSafetyObserver(input))).target;
    expect(checkTarget(target).identity).toBe('FAIL');
  });
  it('canonical trims/case normalizes valid IDs and denies case-only matches', () => {
    const target = { ...policy.target, expectedDatabaseId: ' ' + FIXTURE_DATABASE_ID.toUpperCase() + ' ', expectedAccountId: ' ' + FIXTURE_ACCOUNT_ID.toUpperCase() + ' ' };
    expect(checkTarget(target).identity).toBe('PASS');
    target.deniedDatabaseIds = [' ' + FIXTURE_DATABASE_ID.toUpperCase() + ' ']; expect(checkTarget(target).identity).toBe('FAIL');
  });
  it.each(['FAKE_TEST', 'LOCAL_SIMULATION', 'REMOTE_OBSERVED', 'UNKNOWN'] as const)('provenance %s plus all human approvals cannot authorize remote execution', async kind => {
    policy.approvalChecks = Object.fromEntries(Array.from({ length: 37 }, (_, i) => ['P' + String(i + 1).padStart(2, '0'), { kind: 'HumanApproval' as const, decision: 'APPROVED' as const }]));
    if (kind === 'LOCAL_SIMULATION') policy.observations = await observeSafety(new LocalSafetyObserver({ debugBindings: false, sourceInArgs: false, sourceInEnv: false, evidenceContainsValues: false }));
    if (kind === 'UNKNOWN') policy.observations = await observeSafety(new FakeRemoteSafetyObserver({}));
    if (kind === 'REMOTE_OBSERVED') policy.observations = Object.fromEntries(Object.entries(policy.observations).map(([key, value]) => [key, { ...value, origin: 'REMOTE_OBSERVED' }])) as typeof policy.observations;
    const report = await preparedPreflight(source, adapter, policy);
    expect(remoteFactsEligible(policy.observations)).toBe(false); expect(report.remoteFactsEligible).toBe(false); expect(report.executionApproved).toBe(false);
  });
  const validRate = (): RateRow => ({ id: 'rate-fixture', key: 'no-trusted-ip|/sign-up/email', count: 1, lastRequest: Date.now() });
  it.each(['excessive rows', 'control key', 'long key', 'negative count', 'huge count', 'fractional count', 'invalid timestamp', 'future timestamp', 'stale timestamp', 'extra column', 'missing column', 'unknown path'] as const)('rate baseline rejects %s', kind => {
    const row = validRate(); let rows: RateRow[] = [row];
    if (kind === 'excessive rows') rows = Array.from({ length: RATE_BASELINE_LIMITS.rows + 1 }, (_, i) => ({ ...row, id: 'r' + i }));
    if (kind === 'control key') row.key += '\n';
    if (kind === 'long key') row.key = 'x'.repeat(RATE_BASELINE_LIMITS.keyLength + 1);
    if (kind === 'negative count') row.count = -1;
    if (kind === 'huge count') row.count = 1000000;
    if (kind === 'fractional count') row.count = 0.5;
    if (kind === 'invalid timestamp') row.lastRequest = NaN;
    if (kind === 'future timestamp') row.lastRequest += RATE_BASELINE_LIMITS.futureSkewMs + 60000;
    if (kind === 'stale timestamp') row.lastRequest -= RATE_BASELINE_LIMITS.maxAgeMs + 60000;
    if (kind === 'extra column') Object.assign(row, { expiresAt: Date.now() });
    if (kind === 'missing column') delete (row as Partial<RateRow>).id;
    if (kind === 'unknown path') row.key = 'no-trusted-ip|/not-a-bootstrap-path';
    expect(captureRateBaseline(rows, { ownerExact: true, sessions: 0 }).status).toBe('Unknown');
  });
  it.each(['remove', 'count', 'timestamp'] as const)('baseline detects %s mutation', kind => {
    const rows = [validRate()]; const baseline = captureRateBaseline(rows, { ownerExact: true, sessions: 0 });
    if (kind === 'remove') rows.pop();
    if (kind === 'count') rows[0].count++;
    if (kind === 'timestamp') rows[0].lastRequest--;
    expect(checkRateBaseline(rows, baseline)).toBe('FAIL');
  });
  it('bootstrap is explicitly fake and email match is computed', async () => {
    expect((await bootstrap.inspectOwner()).provenance).toBe('LOCAL_FAKE'); expect((await bootstrap.inspectOwner()).remoteEligible).toBe(false);
    const wrong = new FakeLoopbackOwnerBootstrap(adapter, { ...owner, email: 'other@example.invalid' }, { signup: async () => undefined, logout: async () => undefined });
    expect((await wrong.inspectOwner()).expectedMaskedEmailMatch).toBe(false);
  });
  it.each(['middle', 'postcondition'] as const)('planned %s failure causes complete local rollback', async kind => {
    const before = snapshot(); const metadata = await adapter.inspectSchema(); const plan = await prepareDisposablePlan(source, adapter, policy);
    expect(plan.steps).toContain('forced middle failure'); expect(plan.steps).toContain('forced postcondition failure');
    await expect(adapter.executeFixture(kind === 'middle' ? plan.middleFailureBatch : plan.postconditionFailureBatch)).rejects.toThrow('FIXTURE_BATCH_FAILED');
    expect(snapshot() === before).toBe(true); expect((await adapter.inspectSchema()).triggerFingerprint).toBe(metadata.triggerFingerprint);
  });
  it('planned duplicate rejects second submission with unchanged data', async () => {
    const plan = await prepareDisposablePlan(source, adapter, policy); expect(plan.steps).toContain('duplicate rejection and unchanged-state check'); expect(plan.steps.length).toBe(15);
    await adapter.executeFixture(plan.statements); const before = snapshot();
    await expect(adapter.executeFixture(plan.duplicateRetryBatch)).rejects.toThrow('FIXTURE_BATCH_FAILED'); expect(snapshot() === before).toBe(true);
  });
  it.each(['NOT_EXECUTED', 'COMPLETED', 'UNEXPECTED_PARTIAL_OR_UNKNOWN'] as const)('canonical recovery %s requires correct human approval', outcome => {
    const result = recoveryMeaning(outcome); expect(result.automaticRetry).toBe(false); expect(result.humanApprovalRequired).toBe(outcome !== 'COMPLETED');
    if (outcome === 'COMPLETED') expect(result.action).toBe('none');
  });
  it('fake or forged remote bootstrap cannot become remote eligible', async () => {
    const summary = await bootstrap.inspectOwner(); expect(remoteBootstrapEligible(summary)).toBe(false);
    expect(remoteBootstrapEligible({ ...summary, provenance: 'REMOTE_OBSERVED' })).toBe(false);
    expect((await preparedPreflight(source, adapter, policy)).remoteBootstrapEligible).toBe(false);
  });
});

describe('Stage3E1 rate baseline elapsed-time regression', () => {
  const captureTime = 1800000000000;
  const rowsAtCapture = (): RateRow[] => [{ id: 'elapsed-fixture', key: 'no-trusted-ip|/sign-up/email', count: 1, lastRequest: captureTime }];
  const afterLogout = { ownerExact: true, sessions: 0 };
  // Mock only the wall clock; fixture setup and network tripwires remain active.
  afterEach(() => vi.mocked(Date.now).mockRestore());
  it.each([0, 5, 11, 60])('identical rows pass after %i minutes', minutes => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(captureTime);
    const rows = rowsAtCapture(); const baseline = captureRateBaseline(rows, afterLogout);
    expect(baseline.status).toBe('Observed');
    clock.mockReturnValue(captureTime + minutes * 60000);
    expect(checkRateBaseline(rows, baseline)).toBe('PASS');
  });
  it.each(['add', 'delete', 'key', 'count', 'timestamp'] as const)('rejects %s mutation after 60 minutes', mutation => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(captureTime);
    const rows = rowsAtCapture(); const baseline = captureRateBaseline(rows, afterLogout);
    expect(baseline.status).toBe('Observed');
    clock.mockReturnValue(captureTime + 60 * 60000);
    if (mutation === 'add') rows.push({ ...rows[0], id: 'elapsed-extra', key: 'no-trusted-ip|/sign-out' });
    if (mutation === 'delete') rows.pop();
    if (mutation === 'key') rows[0].key = 'no-trusted-ip|/sign-in/email';
    if (mutation === 'count') rows[0].count++;
    if (mutation === 'timestamp') rows[0].lastRequest--;
    expect(checkRateBaseline(rows, baseline)).toBe('FAIL');
  });
  it.each([-11 * 60000, 6000])('rejects capture timestamp offset %i ms', offset => {
    vi.spyOn(Date, 'now').mockReturnValue(captureTime);
    const rows = rowsAtCapture(); rows[0].lastRequest += offset;
    const baseline = captureRateBaseline(rows, afterLogout);
    expect(baseline.status).toBe('Unknown');
    expect(checkRateBaseline(rows, baseline)).toBe('UNKNOWN');
  });
});
