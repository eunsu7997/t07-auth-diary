import { tables, contract, isLoaded, reject, type Source, type Counts, type Row } from '../stage3d/source.ts';
import { APPROVED_MIGRATIONS, type BoundStatement, type SchemaRow, type Owner } from '../stage3d/adapters.ts';
import { enforceLimits } from '../stage3d/import-plan.ts';
import type { CheckState } from '../stage3d/preflight.ts';
import { D1PreparationAdapter, schemaFingerprint, remoteBootstrapEligible, type LoopbackOwnerBootstrap } from './d1-adapter.ts';
import { checkTarget, observedChecks, checkRateBaseline, baselineRows, remoteFactsEligible, type HumanApproval, type RateBaseline, type SafetyObservations, type RemoteTargetPolicy } from './safety.ts';
export type PreparationPolicy = {
  target: RemoteTargetPolicy; observations: SafetyObservations; sourceSha: string; sourceCounts: Counts; owner: Owner;
  expectedSchema: readonly SchemaRow[]; rateBaseline: RateBaseline;
  ownerBootstrap?: Awaited<ReturnType<LoopbackOwnerBootstrap['inspectOwner']>>;
  // Human review/approval not observable yet: explicit Unknown by default, never auto-filled.
  approvalChecks: Partial<Record<string, HumanApproval>>;
};
const allIds = Array.from({ length: 37 }, (_, i) => 'P' + String(i + 1).padStart(2, '0'));
const state = (value: boolean): CheckState => value ? 'PASS' : 'FAIL';
export async function preparedPreflight(source: Source, adapter: D1PreparationAdapter, policy: PreparationPolicy) {
  const metadata = await adapter.inspectSchema(); const owner = await adapter.ownerSummary(policy.owner);
  const rates = await adapter.rateRows(); const rate = checkRateBaseline(rates, policy.rateBaseline);
  const target = checkTarget(policy.target); const observed = observedChecks(policy.observations);
  const counts: Record<string, number> = {};
  for (const table of tables) counts[table] = (await adapter.read<{ n: number }>(`SELECT count(*) AS n FROM ${table}`))[0].n;
  const empty = Object.values(counts).every(n => n === 0) && (await adapter.read<{ n: number }>('SELECT count(*) AS n FROM _account_deletion_scope'))[0].n === 0;
  const verification = (await adapter.read<{ n: number }>('SELECT count(*) AS n FROM verification'))[0].n;
  const fkEnabled = (await adapter.read<{ foreign_keys: number }>('PRAGMA foreign_keys'))[0]?.foreign_keys === 1;
  const schema = metadata.schemaFingerprint === schemaFingerprint([...policy.expectedSchema]);
  const triggers = metadata.triggerFingerprint === schemaFingerprint([...policy.expectedSchema], true) && metadata.schema.filter(r => r.type === 'trigger').length === 17;
  const loaded = isLoaded(source);
  const auth = owner.ownerExact && owner.sessionCount === 0 && verification === 0;
  const checks: Record<string, CheckState> = Object.fromEntries(allIds.map(id => {
    const a = policy.approvalChecks[id]; return [id, a?.kind !== 'HumanApproval' ? 'UNKNOWN' : a.decision === 'APPROVED' ? 'PASS' : a.decision === 'REJECTED' ? 'FAIL' : 'UNKNOWN'];
  }));
  Object.assign(checks, {
    P03: target.confirmation, P04: target.identity, P06: state(loaded && source.sha === policy.sourceSha),
    P07: state(source.data.schema_version === '2.0.0' && tables.every(t => source.counts[t] === policy.sourceCounts[t])), P08: state(loaded), P09: state(loaded),
    P10: state(JSON.stringify(metadata.migrations) === JSON.stringify(Object.keys(APPROVED_MIGRATIONS))), P11: state(schema), P12: state(triggers), P13: state(empty),
    P14: state(owner.ownerExact), P15: state(owner.ownerExact), P17: state(metadata.fkClean && fkEnabled),
    P18: observed.writers, P21: observed.recovery, P25: state(owner.ownerExact), P26: state(owner.ownerExact && owner.expectedMaskedEmailMatch), P27: state(owner.sessionCount === 0),
    P28: !auth ? 'FAIL' : rate, P29: observed.proxy, P30: observed.verification, P31: observed.leak,
    P32: observed.writers, P33: state(schema), P34: state(triggers), P35: state(empty), P36: observed.recovery,
  });
  // No approval flag can override observed facts; source/rate/schema values stay internal.
  return { checks: allIds.map(id => ({ id, state: checks[id] })), allPass: allIds.every(id => checks[id] === 'PASS'), remoteFactsEligible: remoteFactsEligible(policy.observations), remoteBootstrapEligible: remoteBootstrapEligible(policy.ownerBootstrap), executionApproved: false as const, metadata, rates };
}
// Simple documented JSON extraction error replaces SQLite integer overflow.
// Malformed JSON error is documented; CASE evaluation + batch rollback still needs disposable proof.
const guard = (condition: string, params: BoundStatement['params']): BoundStatement => Object.freeze({
  sql: `SELECT CASE WHEN (${condition}) THEN 1 ELSE json_extract('not-json','$') END AS guard_ok`, params: Object.freeze([...params]) });
function rateGuard(baseline: RateBaseline) {
  const rows = baselineRows(baseline) ?? reject('RATE_BASELINE_UNKNOWN');
  return guard(`(SELECT count(*) FROM rateLimit)=? AND NOT EXISTS(SELECT 1 FROM json_each(?) e WHERE NOT EXISTS(SELECT 1 FROM rateLimit r WHERE r.id IS json_extract(e.value,'$.id') AND r.key IS json_extract(e.value,'$.key') AND r.count IS json_extract(e.value,'$.count') AND r.lastRequest IS json_extract(e.value,'$.lastRequest')))`, [rows.length, JSON.stringify(rows)]);
}
function schemaGuard(rows: SchemaRow[]) {
  const raw = rows.map(r => ({ ...r, sql: r.sql?.replace(/\r\n/g, '\n').trim() ?? null })); const json = JSON.stringify(raw);
  return guard(`(SELECT count(*) FROM _account_deletion_scope)=0 AND (SELECT count(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%')=json_array_length(?) AND NOT EXISTS(SELECT 1 FROM json_each(?) e WHERE NOT EXISTS(SELECT 1 FROM sqlite_master m WHERE m.type=json_extract(e.value,'$.type') AND m.name=json_extract(e.value,'$.name') AND m.tbl_name=json_extract(e.value,'$.tbl_name') AND trim(replace(m.sql,char(13)||char(10),char(10))) IS json_extract(e.value,'$.sql')))`, [json, json]);
}
function insert(table: typeof tables[number], rows: Row[], owner: string): BoundStatement[] {
  const columns = Object.keys(contract.$defs[table].properties); const owned = table === 'plans' || table === 'tags'; const fields = [...columns, ...(owned ? ['owner_user_id'] : [])];
  const output: BoundStatement[] = []; const step = Math.floor(100 / fields.length);
  for (let i = 0; i < rows.length; i += step) {
    const chunk = rows.slice(i, i + step);
    output.push({ sql: `INSERT INTO ${table} (${fields.join(',')}) VALUES ${chunk.map(() => '(' + fields.map(() => '?').join(',') + ')').join(',')}`,
      params: chunk.flatMap(r => [...columns.map(c => r[c]), ...(owned ? [owner] : [])]) });
  }
  return output;
}
export function detectUnsupportedSql(sql: string) {
  const normalized = sql.replace(/'(?:''|[^'])*'/g, "''");
  return /\bUPDATE\b[\s\S]*\bFROM\b|\b(?:BEGIN|COMMIT|ROLLBACK|DROP\s+TRIGGER)\b|\bpragma_\w+\s*\(|abs\s*\(\s*-9223372036854775808/i.test(normalized);
}
export async function prepareDisposablePlan(source: Source, adapter: D1PreparationAdapter, policy: PreparationPolicy) {
  const preflight = await preparedPreflight(source, adapter, policy);
  // Candidate generation is permitted offline, never execution; all unresolved gates are recorded.
  if (!isLoaded(source) || source.sha !== policy.sourceSha) reject('SOURCE_HASH_MISMATCH');
  if (preflight.checks.some(c => c.state === 'FAIL')) reject('PREPARATION_CHECK_FAILED');
  const statements: BoundStatement[] = [];
  const owner = policy.owner.id;
  statements.push(guard(`${tables.map(t => `(SELECT count(*) FROM ${t})=0`).join(' AND ')} AND (SELECT count(*) FROM user)=1 AND EXISTS(SELECT 1 FROM user WHERE id=? AND email=?) AND (SELECT count(*) FROM account)=1 AND EXISTS(SELECT 1 FROM account WHERE userId=? AND accountId=? AND providerId='credential' AND password IS NOT NULL AND length(password)>0) AND (SELECT count(*) FROM session)=0 AND (SELECT count(*) FROM verification)=0`, [owner, policy.owner.email, owner, owner]));
  const migrations = JSON.stringify(Object.keys(APPROVED_MIGRATIONS));
  statements.push(guard('(SELECT count(*) FROM d1_migrations)=json_array_length(?) AND NOT EXISTS(SELECT 1 FROM json_each(?) e WHERE NOT EXISTS(SELECT 1 FROM d1_migrations WHERE name=e.value))', [migrations, migrations]));
  statements.push(schemaGuard(preflight.metadata.schema), rateGuard(policy.rateBaseline));
  for (const t of ['plans', 'plan_versions', 'tags'] as const) statements.push(...insert(t, source.data[t], owner));
  for (const stage of source.taskStages) statements.push(...insert('tasks', stage, owner));
  statements.push(...insert('task_tags', source.data.task_tags, owner));
  const ids = [...new Set(source.data.execution_logs.map(e => String(e.task_id)))];
  if (ids.length) statements.push({ sql: `UPDATE tasks SET status='in_progress',completed_at=NULL,deleted_at=NULL WHERE id IN (${ids.map(() => '?').join(',')})`, params: ids });
  statements.push(...insert('execution_logs', source.data.execution_logs, owner));
  // Plain parameterized UPDATE per task, no UPDATE FROM or source JSON in SQL literals.
  for (const task of source.data.tasks.filter(t => ids.includes(String(t.id)))) statements.push({ sql: 'UPDATE tasks SET status=?,completed_at=?,deleted_at=?,updated_at=? WHERE id=?', params: [task.status, task.completed_at, task.deleted_at, task.updated_at, task.id] });
  for (const t of tables) {
    const owned = t === 'plans' || t === 'tags'; const cols = Object.keys(contract.$defs[t].properties);
    statements.push(guard(`(SELECT count(*) FROM ${t})=? AND NOT EXISTS(SELECT 1 FROM json_each(?) e WHERE NOT EXISTS(SELECT 1 FROM ${t} t WHERE ${cols.map(c => `t.${c} IS json_extract(e.value,'$.${c}')`).join(' AND ')}${owned ? ' AND t.owner_user_id=?' : ''}))`, [source.counts[t], JSON.stringify(source.data[t]), ...(owned ? [owner] : [])]));
  }
  statements.push(rateGuard(policy.rateBaseline), schemaGuard(preflight.metadata.schema));
  if (statements.some(s => detectUnsupportedSql(s.sql))) reject('UNSUPPORTED_SQL');
  const metrics = enforceLimits(statements);
  const measuredChecks = preflight.checks.map(c => c.id === 'P22' ? { ...c, state: 'PASS' as const } : c);
  const sealed = Object.freeze(statements.map(s => Object.freeze({ sql: s.sql, params: Object.freeze([...s.params]) })));
  const middle = sealed.findIndex(s => s.sql.startsWith('INSERT INTO tasks'));
  const postcondition = sealed.findIndex(s => s.sql.includes('(SELECT count(*) FROM plans)=?'));
  if (middle < 0 || postcondition < 0) reject('FAILURE_SCENARIO_MISSING');
  const replaceFailure = (index: number) => Object.freeze(sealed.map((s, i) => i === index ? guard('0', []) : s));
  return { statements: sealed, forcedFailureBatch: Object.freeze([...sealed, guard('0', [])]), metrics, sourceSha: source.sha,
    middleFailureBatch: replaceFailure(middle), postconditionFailureBatch: replaceFailure(postcondition), duplicateRetryBatch: sealed,
    unresolvedChecks: measuredChecks.filter(c => c.state !== 'PASS'), executionApproved: false as const,
    steps: ['disposable D1 creation (separate approval)', 'migrations', 'schema/trigger/target/source SHA checks', 'synthetic owner and rateLimit baseline', 'normal batch commit', 'result verification', 'reset or new disposable state', 'forced middle failure', 'middle rollback verification', 'forced postcondition failure', 'postcondition rollback verification', 'normal import', 'duplicate rejection and unchanged-state check', 'unknown outcome readback', 'disposable cleanup (separate approval)'] };
}
export async function executeRemoteTest(_plan: unknown, _confirm: boolean): Promise<never> { return reject('REMOTE_TEST_NOT_APPROVED'); }
