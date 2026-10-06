import { tables, contract, reject, isLoaded, type Source, type Row } from './source.ts';
import { runPreflight, type Policy } from './preflight.ts';
import type { ImportDatabase, BoundStatement, Inspection } from './adapters.ts';
export type ImportPlan = Readonly<{ statements: readonly BoundStatement[]; metrics: ReturnType<typeof measure>; source: Source; owner: string }>;
const validPlans = new WeakMap<object, ImportDatabase>();
export function measure(statements: readonly BoundStatement[]) {
  const perStatement = statements.map(s => ({ binds: s.params.length, sqlBytes: Buffer.byteLength(s.sql, 'utf8') }));
  return { statements: statements.length, maxBinds: Math.max(0, ...perStatement.map(s => s.binds)), maxSqlBytes: Math.max(0, ...perStatement.map(s => s.sqlBytes)),
    totalSqlBytes: perStatement.reduce((n, s) => n + s.sqlBytes, 0), boundBytes: statements.reduce((n, s) => n + Buffer.byteLength(JSON.stringify(s.params)), 0), perStatement };
}
export function enforceLimits(statements: readonly BoundStatement[]) {
  const m = measure(statements);
  if (m.maxBinds > 100) reject('BIND_LIMIT_EXCEEDED');
  if (m.maxSqlBytes > 100000) reject('SQL_LIMIT_EXCEEDED');
  if (m.statements > 50) reject('STATEMENT_LIMIT_EXCEEDED');
  return m;
}
// Evaluates to integer overflow on failure: a real SQL error, never a SELECT-only advisory.
const guard = (db: ImportDatabase, condition: string, params: BoundStatement['params'] = []) =>
  db.prepare(`SELECT CASE WHEN (${condition}) THEN 1 ELSE abs(-9223372036854775808) END AS guard_ok`, params);
const schemaCondition = `
 (SELECT count(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%') = json_array_length(?)
 AND NOT EXISTS (SELECT 1 FROM json_each(?) e WHERE NOT EXISTS (
 SELECT 1 FROM sqlite_master m WHERE m.type=json_extract(e.value,'$.type') AND m.name=json_extract(e.value,'$.name')
 AND m.tbl_name=json_extract(e.value,'$.tbl_name') AND trim(replace(m.sql,char(13)||char(10),char(10))) IS json_extract(e.value,'$.sql'))) `;
export function initialGuard(db: ImportDatabase, policy: Policy) {
  const empty = tables.map(t => `(SELECT count(*) FROM ${t})=0`).join(' AND ');
  const schema = JSON.stringify(policy.baseline.schema);
  const migrations = JSON.stringify(policy.baseline.migrations);
  return guard(db, `${empty} AND
 (SELECT count(*) FROM user)=1 AND EXISTS(SELECT 1 FROM user WHERE id=? AND email=?) AND
 (SELECT count(*) FROM account)=1 AND EXISTS(SELECT 1 FROM account WHERE userId=? AND accountId=? AND providerId='credential' AND password IS NOT NULL AND length(password)>0) AND
 (SELECT count(*) FROM session)=0 AND (SELECT count(*) FROM verification)=0 AND (SELECT count(*) FROM rateLimit)=0 AND
 (SELECT count(*) FROM _migrations)=json_array_length(?) AND NOT EXISTS(SELECT 1 FROM json_each(?) e WHERE NOT EXISTS(SELECT 1 FROM _migrations WHERE name=e.value)) AND
 ${schemaCondition}`, [policy.owner.id, policy.owner.email, policy.owner.id, policy.owner.id, migrations, migrations, schema, schema]);
}
function insertRows(db: ImportDatabase, table: typeof tables[number], rows: Row[], owner: string): BoundStatement[] {
  if (!rows.length) return [];
  const cols = Object.keys(contract.$defs[table].properties) as string[];
  const owned = table === 'plans' || table === 'tags'; const fields = owned ? [...cols, 'owner_user_id'] : cols;
  const chunkSize = Math.floor(100 / fields.length); const output: BoundStatement[] = [];
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    output.push(db.prepare(`INSERT INTO ${table} (${fields.join(',')}) VALUES ${chunk.map(() => '(' + fields.map(() => '?').join(',') + ')').join(',')}`,
      chunk.flatMap(r => [...cols.map(c => r[c]), ...(owned ? [owner] : [])])));
  }
  return output;
}
export function postconditionGuards(db: ImportDatabase, source: Source, owner: string) {
  return tables.map(table => {
    const cols = Object.keys(contract.$defs[table].properties) as string[];
    const owned = table === 'plans' || table === 'tags';
    const fields = cols.map(c => `t.${c} IS json_extract(e.value,'$.${c}')`).join(' AND ');
    // JSON is bound data, not SQL interpolation. Equality covers ALL original fields/IDs, including nulls.
    return guard(db, `(SELECT count(*) FROM ${table})=? AND NOT EXISTS(SELECT 1 FROM json_each(?) e WHERE NOT EXISTS(SELECT 1 FROM ${table} t WHERE ${fields}${owned ? ' AND t.owner_user_id=?' : ''}))`,
      [source.counts[table], JSON.stringify(source.data[table]), ...(owned ? [owner] : [])]);
  });
}
export function generatePlan(db: ImportDatabase, source: Source, policy: Policy): ImportPlan {
  if (!isLoaded(source) || source.sha !== policy.allowedSha) reject('SOURCE_HASH_MISMATCH');
  // Only local/fake implementations; no approved design can enable a real remote target.
  if (db.kind !== 'local' && db.kind !== 'fake-remote') reject('REMOTE_IMPORT_NOT_IMPLEMENTED');
  const state = db.inspect();
  // Build and measure before P22; attestation cannot override measured limits.
  const statements: BoundStatement[] = [initialGuard(db, policy)];
  for (const t of ['plans', 'plan_versions', 'tags'] as const) statements.push(...insertRows(db, t, source.data[t], policy.owner.id));
  for (const stage of source.taskStages) statements.push(...insertRows(db, 'tasks', stage, policy.owner.id));
  statements.push(...insertRows(db, 'task_tags', source.data.task_tags, policy.owner.id));
  const logTaskIds = [...new Set(source.data.execution_logs.map(e => String(e.task_id)))];
  if (logTaskIds.length) {
    statements.push(db.prepare("UPDATE tasks SET status='in_progress',completed_at=NULL,deleted_at=NULL WHERE id IN (SELECT value FROM json_each(?))", [JSON.stringify(logTaskIds)]));
    statements.push(...insertRows(db, 'execution_logs', source.data.execution_logs, policy.owner.id));
    const restored = source.data.tasks.filter(t => logTaskIds.includes(String(t.id)));
    statements.push(db.prepare(`UPDATE tasks SET
      status=json_extract(e.value,'$.status'),completed_at=json_extract(e.value,'$.completed_at'),
      deleted_at=json_extract(e.value,'$.deleted_at'),updated_at=json_extract(e.value,'$.updated_at')
      FROM json_each(?) e WHERE tasks.id=json_extract(e.value,'$.id')`, [JSON.stringify(restored)]));
  }
  statements.push(...postconditionGuards(db, source, policy.owner.id));
  const schema = JSON.stringify(policy.baseline.schema);
  statements.push(guard(db, schemaCondition, [schema, schema]));
  const metrics = enforceLimits(statements);
  const report = runPreflight(source, state, { ...policy, attestations: { ...policy.attestations, limitsMeasured: true } });
  if (!report.allowed) reject('PREFLIGHT_BLOCKED');
  const plan = Object.freeze({ statements: Object.freeze(statements), metrics, source, owner: policy.owner.id });
  validPlans.set(plan, db); return plan;
}
export async function executeLocalPlan(db: ImportDatabase, plan: ImportPlan) {
  if (validPlans.get(plan) !== db) reject('PLAN_NOT_AUTHORIZED');
  // Consume before submission: NEVER automatically retry, even after unknown outcome.
  validPlans.delete(plan); await db.batch(plan.statements);
}
export type Outcome = 'NOT_EXECUTED' | 'COMPLETED' | 'UNEXPECTED_PARTIAL_OR_UNKNOWN';
const canonical = (rows: Row[]) => JSON.stringify(rows.map(r => Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)))).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
export function classifyOutcome(snapshot: Inspection, before: Inspection, source: Source, owner: string): Outcome {
  if (!snapshot.settled || !snapshot.fkClean || !snapshot.foreignKeys || snapshot.identifier !== before.identifier || snapshot.schemaFingerprint !== before.schemaFingerprint ||
      snapshot.triggerFingerprint !== before.triggerFingerprint || snapshot.authFingerprint !== before.authFingerprint || JSON.stringify(snapshot.migrations) !== JSON.stringify(before.migrations) ||
      JSON.stringify(snapshot.migrationHashes) !== JSON.stringify(before.migrationHashes)) return 'UNEXPECTED_PARTIAL_OR_UNKNOWN';
  if (tables.every(t => snapshot.counts[t] === 0) && tables.every(t => before.counts[t] === 0)) return 'NOT_EXECUTED';
  const complete = tables.every(t => snapshot.counts[t] === source.counts[t] && canonical(snapshot.business[t]) === canonical(source.data[t].map(r =>
    t === 'plans' || t === 'tags' ? { ...r, owner_user_id: owner } : r)));
  return complete ? 'COMPLETED' : 'UNEXPECTED_PARTIAL_OR_UNKNOWN';
}
export function recoveryDecision(outcome: Outcome) {
  return { outcome, automaticRetry: false as const, humanInterventionRequired: outcome === 'UNEXPECTED_PARTIAL_OR_UNKNOWN' };
}
