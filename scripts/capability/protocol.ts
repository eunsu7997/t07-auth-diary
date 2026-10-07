// Shared by the supervisor and fixed Node runner. No I/O or caller SQL.
import { createHash } from 'node:crypto';
export type Target = Readonly<{ purpose: string; expectedDatabaseId: string; expectedAccountId: string; expectedName: string; deniedDatabaseIds: readonly string[]; explicitConfirmation: boolean }>;
export type Operation = Readonly<{ kind: 'GET'; path: string }> | Readonly<{ kind: 'QUERY'; id: string }>;
export type WireRequest = Readonly<{ method: 'GET' | 'POST'; path: string; body: string }>;
const queries = Object.freeze({ PROXY: 'SELECT 1 AS proxy_ok', TABLES: "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name", TRIGGERS: "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type='trigger' AND name NOT LIKE 'sqlite_%' ORDER BY name", FK_CHECK: 'PRAGMA foreign_key_check', SESSION_COUNT: 'SELECT count(*) AS n FROM session' });
const fail = (): never => { throw new Error('OBSERVATION_REQUEST_DENIED'); };
export function validateTarget(p: Target) {
  if (!p || p.purpose !== 'DISPOSABLE_TEST' || p.explicitConfirmation !== true || !/^[a-f0-9]{32}$/.test(p.expectedAccountId) || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(p.expectedDatabaseId) || !/^aleph-t07-disposable-[a-z0-9-]+$/.test(p.expectedName) || !Array.isArray(p.deniedDatabaseIds) || !p.deniedDatabaseIds.length || p.deniedDatabaseIds.some(v => !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v)) || p.deniedDatabaseIds.includes(p.expectedDatabaseId)) fail();
}
export function compileObservation(p: Target, operation: Operation): WireRequest {
  validateTarget(p);
  if (!operation || typeof operation !== 'object') return fail();
  const a = `/client/v4/accounts/${p.expectedAccountId}`, d = `${a}/d1/database/${p.expectedDatabaseId}`;
  if (operation.kind === 'QUERY') {
    if (Object.keys(operation).sort().join(',') !== 'id,kind' || !Object.hasOwn(queries, operation.id)) return fail();
    return Object.freeze({ method: 'POST', path: `${d}/query`, body: JSON.stringify({ sql: queries[operation.id as keyof typeof queries], params: [] }) });
  }
  if (operation.kind !== 'GET' || Object.keys(operation).sort().join(',') !== 'kind,path' || typeof operation.path !== 'string' || !operation.path.startsWith('/client/v4/')) return fail();
  const url = new URL(operation.path, 'https://api.cloudflare.com');
  if (url.origin !== 'https://api.cloudflare.com' || url.username || url.password || url.hash || url.pathname !== operation.path.split('?')[0]) return fail();
  const path = url.pathname;
  const inventory = path === `${a}/workers/scripts` || path === '/client/v4/zones';
  const fixed = path === a || path === d || path === `${d}/time_travel/bookmark` || path === `${a}/tokens/verify` || new RegExp(`^${a}/tokens/[a-f0-9]{32}$`).test(path) || new RegExp(`^${a}/workers/scripts/[a-zA-Z0-9_-]+/(settings|deployments|schedules)$`).test(path);
  // Zone route inventory requires additional account-bound authorization, not caller IDs.
  if (!inventory && !fixed) return fail();
  if (inventory) {
    const expectedKeys = path === '/client/v4/zones' ? 'account.id,page,per_page' : 'page,per_page';
    if ([...url.searchParams.keys()].sort().join(',') !== expectedKeys || !/^[1-9][0-9]?$/.test(url.searchParams.get('page') ?? '') || Number(url.searchParams.get('page')) > 20 || url.searchParams.get('per_page') !== '100' || path === '/client/v4/zones' && url.searchParams.get('account.id') !== p.expectedAccountId) return fail();
  } else if (url.search) return fail();
  return Object.freeze({ method: 'GET', path: url.pathname + url.search, body: '' });
}
export function requestFingerprint(p: Target, operation: Operation) {
  const wire = compileObservation(p, operation);
  return createHash('sha256').update(JSON.stringify([p.expectedAccountId, p.expectedDatabaseId, p.expectedName, wire.method, wire.path, wire.body])).digest('hex');
}
export function validateEnvelope(value: unknown): unknown {
  if (!value || typeof value !== 'object' || (value as { success?: unknown }).success !== true || !Object.hasOwn(value, 'result')) throw new Error('CONTROL_PLANE_READ_FAILED');
  return value;
}
