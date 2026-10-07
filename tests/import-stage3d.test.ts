import './historical-import-schema.ts';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { digest, loadBytes, tables, type Source } from '../scripts/stage3d/source.ts';
import { LocalImportDatabase, FakeRemoteImportDatabase, FakeLoopbackAuthAdapter, openRemoteImportDatabase, type BoundStatement, type Owner } from '../scripts/stage3d/adapters.ts';
import { runPreflight, type Policy } from '../scripts/stage3d/preflight.ts';
import { generatePlan, executeLocalPlan, classifyOutcome, enforceLimits, recoveryDecision } from '../scripts/stage3d/import-plan.ts';
import { encoded, simulationPolicy, syntheticSource } from './stage3d-fixtures.ts';
class FaultDatabase extends LocalImportDatabase {
  fault?: (statements: readonly BoundStatement[]) => readonly BoundStatement[];
  override async batch(statements: readonly BoundStatement[]) { return super.batch(this.fault ? this.fault(statements) : statements); }
}
let db: FaultDatabase; let source: Source; let policy: Policy; let owner: Owner;
const snapshotDigest = (target: LocalImportDatabase) => digest(JSON.stringify(target.inspect()));
beforeEach(async () => {
  db = new FaultDatabase(); const auth = new FakeLoopbackAuthAdapter(db); owner = await auth.signup(); await auth.logout();
  const f = encoded(); source = loadBytes(f.bytes, f.sha); policy = simulationPolicy(owner, f.sha);
});
afterEach(() => db.close());
it('normal SQLite batch preserves every field, FK, 17 triggers and auth; injected script remains data', async () => {
  const before = db.inspect(); const plan = generatePlan(db, source, policy);
  expect(plan.metrics.maxBinds <= 100 && plan.metrics.statements <= 50).toBe(true);
  expect(plan.statements.every(s => !/DROP\s+TRIGGER/i.test(s.sql))).toBe(true);
  await executeLocalPlan(db, plan); const after = db.inspect();
  expect(classifyOutcome(after, before, source, owner.id)).toBe('COMPLETED');
  expect(after.schema.filter(r => r.type === 'trigger').length).toBe(17);
  expect(after.authFingerprint === before.authFingerprint && after.fkClean && after.triggerFingerprint === before.triggerFingerprint).toBe(true);
});
it('37 checks exactly match approved checklist and simulation never grants remote eligibility', () => {
  const result = runPreflight(source, db.inspect(), policy);
  expect(result.checks.length).toBe(37); expect(result.checks.every(c => c.state === 'PASS')).toBe(true); expect(result.remoteEligible).toBe(false);
});
it.each(['sha', 'schema', 'fk', 'copy-cycle', 'copy-source', 'open-log', 'duration', 'unique'] as const)('source rejection %s leaves DB unchanged', kind => {
  const before = snapshotDigest(db); const input = syntheticSource();
  if (kind === 'schema') input.schema_version = '3.0.0';
  if (kind === 'fk') input.tasks[0].plan_id = 'absent';
  if (kind === 'copy-cycle') { input.tasks[0].copied_from_task_id = 't2'; input.tasks[1].copied_from_task_id = 't1'; }
  if (kind === 'copy-source') input.tasks[5].copied_from_task_id = 't3';
  if (kind === 'open-log') { input.execution_logs[0].ended_at = null; input.execution_logs[0].actual_seconds = null; input.execution_logs[0].finish_request_id = null; input.tasks[0].status = 'in_progress'; input.tasks[0].completed_at = null; }
  if (kind === 'duration') input.execution_logs[0].actual_seconds = 99;
  if (kind === 'unique') input.tags[1].name = input.tags[0].name;
  const f = encoded(input);
  expect(() => loadBytes(f.bytes, kind === 'sha' ? 'bad' : f.sha)).toThrow(/^SOURCE_/);
  expect(snapshotDigest(db) === before).toBe(true);
});
const stateMutations: Record<string, (db: FaultDatabase, p: Policy) => void> = {
  'owner missing': d => { d.local.sqlite.exec('DELETE FROM account; DELETE FROM user'); },
  'owner two': d => { d.local.sqlite.exec("INSERT INTO user VALUES ('second','Synthetic','second@example.invalid',0,NULL,'t','t')"); },
  'account missing': d => { d.local.sqlite.exec('DELETE FROM account'); },
  'account two': d => { d.local.sqlite.exec("INSERT INTO account(id,accountId,providerId,userId,createdAt,updatedAt) SELECT 'second',accountId,providerId,userId,createdAt,updatedAt FROM account"); },
  'accountId mismatch': d => { d.local.sqlite.exec("UPDATE account SET accountId='other'"); },
  'userId mismatch': (d, p) => { p.owner.id = 'other'; },
  'provider mismatch': d => { d.local.sqlite.exec("UPDATE account SET providerId='other'"); },
  'credential missing': d => { d.local.sqlite.exec('UPDATE account SET password=NULL'); },
  'email pair mismatch': (d, p) => { p.owner.email = 'other@example.invalid'; },
  'session exists': d => { d.local.sqlite.prepare("INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,userId) SELECT 'unexpected','t',?,'t','t',id FROM user").run(crypto.randomUUID()); },
  'DB nonempty': (d, p) => { d.local.sqlite.prepare("INSERT INTO plans VALUES ('extra',1,'t','t',?)").run(p.owner.id); },
  'schema mismatch': d => { d.local.sqlite.exec('CREATE TABLE unexpected(n INTEGER)'); },
  'trigger mismatch': d => { d.local.sqlite.exec("CREATE TRIGGER unexpected BEFORE INSERT ON tags BEGIN SELECT RAISE(ABORT,'SYNTHETIC'); END"); },
  'migration mismatch': d => { d.local.sqlite.exec("DELETE FROM _migrations WHERE name='0005_auth_rate_limit.sql'"); },
  'verification exists': d => { d.local.sqlite.exec("INSERT INTO verification VALUES ('v','synthetic','synthetic','t','t','t')"); },
  'rateLimit exists': d => { d.local.sqlite.exec("INSERT INTO rateLimit VALUES ('r','synthetic',1,1)"); },
  'source count mismatch': (d, p) => { p.counts.tasks = 999; },
  'external writer true': (d, p) => { p.safety.routesExist = true; },
  'external writer UNKNOWN': (d, p) => { p.safety.otherBindingsExist = 'UNKNOWN'; },
  'recovery UNKNOWN': (d, p) => { p.recovery.canRestore = 'UNKNOWN'; },
  'permission UNKNOWN': (d, p) => { delete p.attestations.proxyPermission; },
};
it.each(Object.keys(stateMutations))('preflight %s refuses without changes', kind => {
  stateMutations[kind](db, policy); const before = snapshotDigest(db); const calls = db.batches;
  expect(runPreflight(source, db.inspect(), policy).allowed).toBe(false);
  expect(() => generatePlan(db, source, policy)).toThrow('PREFLIGHT_BLOCKED');
  expect(snapshotDigest(db) === before && db.batches === calls).toBe(true);
});
it.each(['productionWorkerExists', 'routesExist', 'otherBindingsExist', 'scheduledWritersExist'] as const)('all writer paths fail closed: %s', key => {
  for (const value of [true, 'UNKNOWN'] as const) { policy.safety[key] = value; expect(runPreflight(source, db.inspect(), policy).allowed).toBe(false); }
});
it.each(['available', 'canReadBookmark', 'canRestore'] as const)('recovery %s UNKNOWN blocks', key => {
  policy.recovery[key] = 'UNKNOWN'; expect(() => generatePlan(db, source, policy)).toThrow('PREFLIGHT_BLOCKED');
});
it('in-batch first SQL guard rejects a session created after preflight', async () => {
  const plan = generatePlan(db, source, policy);
  stateMutations['session exists'](db, policy); const before = snapshotDigest(db);
  await expect(executeLocalPlan(db, plan)).rejects.toThrow('BATCH_REJECTED_OR_UNKNOWN'); expect(snapshotDigest(db) === before).toBe(true);
});
it.each(['middle insert', 'execution insert', 'task restore', 'postcondition'] as const)('real SQLite %s failure rolls back every field/auth/trigger without retry', async kind => {
  const plan = generatePlan(db, source, policy); const before = snapshotDigest(db); const calls = db.batches;
  db.fault = statements => {
    const index = kind === 'middle insert' ? statements.findIndex(s => s.sql.startsWith('INSERT INTO tags')) :
      kind === 'execution insert' ? statements.findIndex(s => s.sql.startsWith('INSERT INTO execution_logs')) :
      kind === 'task restore' ? statements.findIndex(s => s.sql.startsWith('UPDATE tasks SET\n')) :
      statements.findIndex(s => s.sql.includes('FROM plans)=?'));
    if (index < 0) throw new Error('TEST_FAULT_TARGET_MISSING');
    const out = [...statements]; out[index] = kind === 'postcondition' ? db.prepare(statements[index].sql, [999, ...statements[index].params.slice(1)]) : db.prepare('INSERT INTO nonexistent_fixture VALUES (1)'); return out;
  };
  await expect(executeLocalPlan(db, plan)).rejects.toThrow('BATCH_REJECTED_OR_UNKNOWN');
  expect(snapshotDigest(db) === before && db.batches === calls + 1).toBe(true);
  await expect(executeLocalPlan(db, plan)).rejects.toThrow('PLAN_NOT_AUTHORIZED'); expect(db.batches === calls + 1).toBe(true);
});
it('postcondition catches silent field corruption and rolls back', async () => {
  const before = snapshotDigest(db); const plan = generatePlan(db, source, policy);
  db.fault = statements => { const out = [...statements]; const index = out.findIndex(s => s.sql.startsWith('INSERT INTO tasks')); const params = [...out[index].params]; params[2] = 'Synthetic corrupt'; out[index] = db.prepare(out[index].sql, params); return out; };
  await expect(executeLocalPlan(db, plan)).rejects.toThrow(); expect(snapshotDigest(db) === before).toBe(true);
});
it('duplicate import refuses without altering completed DB', async () => {
  await executeLocalPlan(db, generatePlan(db, source, policy)); const before = snapshotDigest(db);
  expect(() => generatePlan(db, source, policy)).toThrow('PREFLIGHT_BLOCKED'); expect(snapshotDigest(db) === before).toBe(true);
});
it.each(['bind', 'sql', 'statements'] as const)('measured %s limit refuses before submission', kind => {
  const before = snapshotDigest(db);
  const statements = kind === 'bind' ? [db.prepare('SELECT 1', Array(101).fill(1))] : kind === 'sql' ? [db.prepare(' '.repeat(100001))] : Array.from({ length: 51 }, () => db.prepare('SELECT 1'));
  expect(() => enforceLimits(statements)).toThrow(/LIMIT_EXCEEDED/); expect(snapshotDigest(db) === before).toBe(true);
});
it('outcome classification is readonly and treats empty in-flight state as unknown', async () => {
  const before = db.inspect(); const calls = db.batches;
  expect(classifyOutcome(before, before, source, owner.id)).toBe('NOT_EXECUTED');
  expect(classifyOutcome({ ...before, settled: false }, before, source, owner.id)).toBe('UNEXPECTED_PARTIAL_OR_UNKNOWN'); expect(db.batches).toBe(calls);
  stateMutations['DB nonempty'](db, policy); const partial = db.inspect();
  expect(classifyOutcome(partial, before, source, owner.id)).toBe('UNEXPECTED_PARTIAL_OR_UNKNOWN'); expect(db.batches).toBe(calls);
});
it('lost response after commit is COMPLETED without automatic retry', async () => {
  const before = db.inspect(); const plan = generatePlan(db, source, policy); const calls = db.batches;
  const original = db.batch.bind(db); db.batch = async statements => { await original(statements); throw new Error('SYNTHETIC_RESPONSE_LOST'); };
  await expect(executeLocalPlan(db, plan)).rejects.toThrow('SYNTHETIC_RESPONSE_LOST');
  expect(classifyOutcome(db.inspect(), before, source, owner.id)).toBe('COMPLETED');
  await expect(executeLocalPlan(db, plan)).rejects.toThrow('PLAN_NOT_AUTHORIZED'); expect(db.batches === calls + 1).toBe(true);
});
it('remote attempts always refuse; fake remote is memory SQLite only', () => {
  const before = snapshotDigest(db); expect(() => openRemoteImportDatabase()).toThrow('REMOTE_IMPORT_NOT_IMPLEMENTED'); expect(snapshotDigest(db) === before).toBe(true);
  const fake = new FakeRemoteImportDatabase(); try { expect(fake.local.sqlite.prepare('PRAGMA database_list').get()?.file).toBe(''); } finally { fake.close(); }
});
it('fake bootstrap has exact credential relationships and logout leaves zero sessions', () => {
  const s = db.inspect(); expect(s.users.length === 1 && s.accounts.length === 1 && s.sessions === 0).toBe(true);
  expect(s.accounts[0].userId === owner.id && s.accounts[0].accountId === owner.id && s.accounts[0].providerId === 'credential').toBe(true);
});
it('UNKNOWN ends with human intervention, never automatic retry', () => {
  const result = recoveryDecision('UNEXPECTED_PARTIAL_OR_UNKNOWN'); expect(result.humanInterventionRequired).toBe(true); expect(result.automaticRetry).toBe(false);
});
it.each(['owner', 'schema', 'trigger', 'business', 'account'] as const)('first atomic guard rejects post-preflight %s drift', async key => {
  const plan = generatePlan(db, source, policy);
  const names = { owner: 'email pair mismatch', schema: 'schema mismatch', trigger: 'trigger mismatch', business: 'DB nonempty', account: 'accountId mismatch' };
  if (key === 'owner') db.local.sqlite.exec("UPDATE user SET email='other@example.invalid'"); else stateMutations[names[key]](db, policy);
  const before = snapshotDigest(db);
  await expect(executeLocalPlan(db, plan)).rejects.toThrow('BATCH_REJECTED_OR_UNKNOWN'); expect(snapshotDigest(db) === before).toBe(true);
});
it('foreign key enforcement disabled after preflight blocks submission', async () => {
  const plan = generatePlan(db, source, policy); db.local.sqlite.exec('PRAGMA foreign_keys=OFF'); const before = snapshotDigest(db);
  await expect(executeLocalPlan(db, plan)).rejects.toThrow('FOREIGN_KEYS_DISABLED'); expect(snapshotDigest(db) === before).toBe(true);
});
it('missing runtime safety flags and malformed attestations cannot pass', () => {
  delete (policy.safety as Partial<typeof policy.safety>).routesExist;
  expect(runPreflight(source, db.inspect(), policy).allowed).toBe(false);
  policy.safety.routesExist = false;
  policy.attestations.proxyPermission = 'unverified' as never;
  const report = runPreflight(source, db.inspect(), policy);
  expect(report.checks.find(c => c.id === 'P29')?.state).toBe('UNKNOWN'); expect(report.allowed).toBe(false);
});
