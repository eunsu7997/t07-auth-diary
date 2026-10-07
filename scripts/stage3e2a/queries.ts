import { tables } from '../stage3d/source.ts';
import type { BoundStatement } from '../stage3d/adapters.ts';
const registry = new Map<string, { sql: string; columns: readonly string[]; params?: number }>([
  ['MIGRATIONS', { sql: 'SELECT name FROM d1_migrations ORDER BY name', columns: ['name'] }],
  ['FK_ENABLED', { sql: 'PRAGMA foreign_keys', columns: ['foreign_keys'] }],
  ['FK_CHECK', { sql: 'PRAGMA foreign_key_check', columns: ['table', 'rowid', 'parent', 'fkid'] }],
  ['SESSION_COUNT', { sql: 'SELECT count(*) AS n FROM session', columns: ['n'] }],
  ['RATE_LIMIT_SUMMARY', { sql: 'SELECT id,key,count,lastRequest FROM rateLimit ORDER BY id', columns: ['id', 'key', 'count', 'lastRequest'] }],
  ['PROXY', { sql: 'SELECT 1 AS proxy_ok', columns: ['proxy_ok'] }],
  ['AUTH_OWNER_SUMMARY', { sql: `SELECT (SELECT count(*) FROM user) AS userCount,(SELECT count(*) FROM account) AS accountCount,
    EXISTS(SELECT 1 FROM user WHERE id=? AND email=?) AS ownerMatches,
    EXISTS(SELECT 1 FROM account WHERE providerId='credential' AND userId=? AND accountId=? AND password IS NOT NULL AND length(password)>0) AS accountMatches`, columns: ['userCount', 'accountCount', 'ownerMatches', 'accountMatches'], params: 4 }],
]);
for (const [id, type] of [['TABLES', 'table'], ['INDEXES', 'index'], ['TRIGGERS', 'trigger']]) registry.set(id, { sql: `SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type='${type}' AND name NOT LIKE 'sqlite_%' ORDER BY name`, columns: ['type', 'name', 'tbl_name', 'sql'] });
for (const table of [...tables, 'user', 'account', 'session', 'verification', 'rateLimit', '_account_deletion_scope']) {
  registry.set('COUNT_' + table, { sql: `SELECT count(*) AS n FROM ${table}`, columns: ['n'] });
  registry.set('FK_LIST_' + table, { sql: `PRAGMA foreign_key_list('${table}')`, columns: ['id', 'seq', 'table', 'from', 'to', 'on_update', 'on_delete', 'match'] });
}
export type D1ObservationQuery = 'MIGRATIONS' | 'TABLES' | 'INDEXES' | 'TRIGGERS' | 'FK_ENABLED' | 'FK_CHECK' | 'SESSION_COUNT' | 'AUTH_OWNER_SUMMARY' | 'RATE_LIMIT_SUMMARY' | 'PROXY' | `COUNT_${string}` | `FK_LIST_${string}`;
export function observationQuery(id: D1ObservationQuery, params: BoundStatement['params'] = []) {
  const entry = registry.get(id);
  if (!entry || params.length !== (entry.params ?? 0) || params.some(v => typeof v !== 'string')) throw new Error('OBSERVATION_QUERY_INVALID');
  return { sql: entry.sql, params: [...params], columns: entry.columns };
}
export function observationIdForSql(sql: string): D1ObservationQuery {
  const entry = [...registry.entries()].find(([, v]) => v.sql === sql);
  if (!entry) throw new Error('OBSERVATION_QUERY_INVALID');
  return entry[0] as D1ObservationQuery;
}
export function projectObservationRows<T>(rows: unknown[], columns: readonly string[]): T[] {
  return rows.map(row => {
    if (!row || typeof row !== 'object' || columns.some(c => !Object.hasOwn(row, c))) throw new Error('D1_RESULT_INVALID');
    const selected = columns.map(c => [c, (row as Record<string, unknown>)[c]] as const);
    if (selected.some(([, v]) => v !== null && typeof v !== 'string' && (typeof v !== 'number' || !Number.isFinite(v)))) throw new Error('D1_RESULT_INVALID');
    return Object.fromEntries(selected) as T;
  });
}
