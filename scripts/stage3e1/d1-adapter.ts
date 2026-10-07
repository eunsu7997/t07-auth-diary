import type { LocalImportDatabase, BoundStatement, SchemaRow, Owner } from '../stage3d/adapters.ts';
import { reject, tables } from '../stage3d/source.ts';
import { fingerprint, captureRateBaseline, type RateRow, type RateBaseline } from './safety.ts';
export interface D1StatementLike {
  bind(...values: (string | number | null)[]): D1StatementLike;
  all<T = Record<string, unknown>>(): Promise<{ success: boolean; results: T[] }>;
}
export interface D1DatabaseLike { prepare(sql: string): D1StatementLike; batch(statements: D1StatementLike[]): Promise<{ success: boolean; results: unknown[] }[]> }
export interface RemoteD1Provider { getDatabase(): Promise<D1DatabaseLike> }
const fixtureProviders = new WeakSet<object>();
export class CloudflareD1Provider implements RemoteD1Provider {
  constructor(readonly targetId: string | 'UNKNOWN') {} // No hardcoded UUID, import side effects or network.
  async connect(): Promise<never> { return reject('REMOTE_TEST_NOT_APPROVED'); }
  async getDatabase(): Promise<never> { return reject('REMOTE_PROVIDER_NOT_CONNECTED'); }
}
export const migrationRegistry = (environment: 'local' | 'd1') => environment === 'd1' ? 'd1_migrations' : '_migrations';
// Token normalization preserves literal strings/quoted identifiers; whitespace inside literals is meaningful.
export function normalizeSql(sql: string | null) {
  if (sql === null) return null;
  const tokens = sql.replace(/\r\n/g, '\n').match(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|\d+(?:\.\d+)?|[^\s]/g) ?? [];
  return tokens.filter(t => !t.startsWith('--') && !t.startsWith('/*')).map(t => /^[A-Za-z_]/.test(t) ? t.toLowerCase() : t).join(' ');
}
export function schemaFingerprint(schema: SchemaRow[], triggersOnly = false) {
  const rows = schema.filter(r => !triggersOnly || r.type === 'trigger').map(r => ({ type: r.type, name: r.name, tbl_name: r.tbl_name, sql: normalizeSql(r.sql) }))
    .sort((a, b) => (a.type + ':' + a.name).localeCompare(b.type + ':' + b.name));
  return fingerprint(rows);
}
export class D1PreparationAdapter {
  private db?: D1DatabaseLike;
  readonly queries: string[] = [];
  constructor(private readonly provider: RemoteD1Provider) {}
  async connect(): Promise<never> { return reject('REMOTE_TEST_NOT_APPROVED'); }
  static async fromFixture(provider: LocalD1FixtureProvider) {
    if (!fixtureProviders.has(provider) || Object.getPrototypeOf(provider) !== LocalD1FixtureProvider.prototype) reject('FIXTURE_PROVIDER_REQUIRED');
    const adapter = new D1PreparationAdapter(provider);
    adapter.db = await LocalD1FixtureProvider.prototype.getDatabase.call(provider); return adapter;
  }
  private database() { return this.db ?? reject('REMOTE_PROVIDER_NOT_CONNECTED'); }
  async read<T>(sql: string, params: BoundStatement['params'] = []): Promise<T[]> {
    this.queries.push(sql);
    try { const response = await this.database().prepare(sql).bind(...params).all<T>(); if (!response.success || !Array.isArray(response.results)) reject('D1_READ_FAILED'); return response.results; }
    catch { return reject('D1_READ_FAILED'); }
  }
  async inspectSchema() {
    // Small queries; never PRAGMA table-valued functions or one large compound SELECT.
    const schema: SchemaRow[] = [];
    for (const type of ['table', 'index', 'trigger']) schema.push(...await this.read<SchemaRow>("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type=? AND name NOT LIKE 'sqlite_%' ORDER BY name", [type]));
    const foreignKeys: Record<string, unknown[]> = {};
    for (const table of [...tables, 'account', 'session', '_account_deletion_scope']) foreignKeys[table] = await this.read(`PRAGMA foreign_key_list('${table}')`);
    const migrations = await this.read<{ name: string }>('SELECT name FROM d1_migrations ORDER BY name');
    return { schema, foreignKeys, migrations: migrations.map(r => r.name), schemaFingerprint: schemaFingerprint(schema), triggerFingerprint: schemaFingerprint(schema, true),
      fkClean: (await this.read('PRAGMA foreign_key_check')).length === 0 };
  }
  async rateRows() { return this.read<RateRow>('SELECT id,key,count,lastRequest FROM rateLimit ORDER BY id'); }
  async ownerSummary(expected: Owner) {
    const users = await this.read<Owner>('SELECT id,email FROM user ORDER BY id');
    const accounts = await this.read<{ providerId: string; userId: string; accountId: string; present: number }>('SELECT providerId,userId,accountId,(password IS NOT NULL AND length(password)>0) AS present FROM account ORDER BY id');
    const sessions = await this.read<{ n: number }>('SELECT count(*) AS n FROM session');
    const exact = users.length === 1 && users[0].id === expected.id && users[0].email === expected.email && accounts.length === 1 && accounts[0].userId === expected.id && accounts[0].accountId === expected.id && accounts[0].providerId === 'credential' && accounts[0].present === 1;
    return { userCount: users.length, exactUserId: exact ? expected.id : undefined, expectedMaskedEmailMatch: users.length === 1 && users[0].email === expected.email,
      maskedEmail: '***@***', accountCount: accounts.length, providerId: accounts[0]?.providerId, accountUserId: accounts[0]?.userId, accountAccountId: accounts[0]?.accountId,
      sessionCount: sessions[0]?.n, ownerExact: exact };
  }
  // Fixture executes real memory SQLite transaction. Remote executions always blocked, even confirmed.
  async executeDisposable(_statements: readonly BoundStatement[], _confirm = false): Promise<never> { return reject('REMOTE_TEST_NOT_APPROVED'); }
  async executeFixture(statements: readonly BoundStatement[]) {
    if (!fixtureProviders.has(this.provider)) reject('REMOTE_TEST_NOT_APPROVED');
    try { const response = await this.database().batch(statements.map(s => this.database().prepare(s.sql).bind(...s.params))); if (response.some(r => !r.success)) reject('FIXTURE_BATCH_FAILED'); }
    catch { reject('FIXTURE_BATCH_FAILED'); }
  }
}
export class LocalD1FixtureProvider implements RemoteD1Provider {
  calls = 0;
  constructor(readonly local: LocalImportDatabase) {
    local.local.sqlite.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
    local.local.sqlite.exec('INSERT INTO d1_migrations(name) SELECT name FROM _migrations; DROP TABLE _migrations');
    fixtureProviders.add(this);
  }
  async getDatabase(): Promise<D1DatabaseLike> {
    this.calls++; const local = this.local;
    class FixtureStatement implements D1StatementLike {
      constructor(readonly sql: string, readonly params: (string | number | null)[] = []) {}
      bind(...values: (string | number | null)[]) { return new FixtureStatement(this.sql, values); }
      async all<T>() { return { success: true, results: local.local.sqlite.prepare(this.sql).all(...this.params) as T[] }; }
    }
    return { prepare: sql => new FixtureStatement(sql), batch: async statements => {
      if (local.local.sqlite.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1) reject('FIXTURE_FK_DISABLED');
      await local.local.batch(statements.map(s => { if (!(s instanceof FixtureStatement)) return reject('FIXTURE_STATEMENT_INVALID'); return { sql: s.sql, params: s.params }; }));
      return statements.map(() => ({ success: true, results: [] }));
    } };
  }
}
export type BootstrapProvenance = 'LOCAL_FAKE' | 'LOCAL_REAL_AUTH' | 'REMOTE_OBSERVED';
export interface LoopbackOwnerBootstrap { signup(): Promise<void>; logout(): Promise<void>; inspectOwner(): Promise<Awaited<ReturnType<D1PreparationAdapter['ownerSummary']>> & { provenance: BootstrapProvenance; remoteEligible: false; rateLimitBaselineSummary: RateBaseline }> }
const bootstrapResults = new WeakSet<object>();
export function remoteBootstrapEligible(summary: Awaited<ReturnType<LoopbackOwnerBootstrap['inspectOwner']>> | undefined) {
  return !!summary && bootstrapResults.has(summary) && summary.provenance === 'REMOTE_OBSERVED' && summary.ownerExact && summary.sessionCount === 0;
}
export class FakeLoopbackOwnerBootstrap implements LoopbackOwnerBootstrap {
  private baseline: RateBaseline = { status: 'Unknown' };
  constructor(private readonly adapter: D1PreparationAdapter, private readonly expected: Owner, private readonly actions: { signup(): Promise<unknown>; logout(): Promise<void> }) {}
  async signup() { await this.actions.signup(); this.baseline = { status: 'Unknown' }; }
  async logout() {
    await this.actions.logout(); const owner = await this.adapter.ownerSummary(this.expected);
    this.baseline = captureRateBaseline(await this.adapter.rateRows(), { ownerExact: owner.ownerExact, sessions: owner.sessionCount });
  }
  async inspectOwner() {
    const result = Object.freeze({ ...await this.adapter.ownerSummary(this.expected), provenance: 'LOCAL_FAKE' as const, remoteEligible: false as const, rateLimitBaselineSummary: this.baseline });
    bootstrapResults.add(result); return result;
  }
}
