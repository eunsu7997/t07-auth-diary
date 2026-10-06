import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { LocalDatabase, projectRoot } from '../../src/server/local-db.ts';
import { tables, digest, reject, type Row, type Counts } from './source.ts';
export type BoundStatement = Readonly<{ sql: string; params: readonly (string | number | null)[] }>;
export type SchemaRow = { type: string; name: string; tbl_name: string; sql: string | null };
export type Owner = { id: string; email: string };
export type Inspection = {
  identifier: string; schema: SchemaRow[]; schemaFingerprint: string; triggerFingerprint: string;
  migrations: string[]; migrationHashes: Record<string, string>; counts: Counts; business: Record<string, Row[]>;
  users: Owner[]; accounts: { userId: string; accountId: string; providerId: string; credentialPresent: boolean }[];
  sessions: number; verification: number; rateLimit: number; fkClean: boolean; foreignKeys: boolean;
  // Digest only for comparisons; never expose auth rows/credential contents.
  authFingerprint: string; settled: boolean;
};
export interface ImportDatabase {
  readonly kind: 'local' | 'fake-remote'; readonly identifier: string;
  prepare(sql: string, params?: BoundStatement['params']): BoundStatement;
  batch(statements: readonly BoundStatement[]): Promise<void>;
  inspect(): Inspection;
  readSchemaFingerprint(): string; readTriggerFingerprint(): string; readCounts(): Counts;
}
// Reviewed migration bytes normalized CRLF -> LF; schema baseline is never learned from target.
export const APPROVED_MIGRATIONS = {
  '0001_initial.sql': 'fae69d6c71b94ff1c6727b69608241725416c0e84ba9ce05efb66f28081888d7',
  '0002_execution_guards.sql': '5c99d85080d833b2207c286a61574852a5035ec08496f1a8874799fd6810f2cd',
  '0003_auth.sql': 'a6e8f988bdc954a9d8c8e02824584921f2d52d92d7493ebd2dff2e5aa948f694',
  '0004_ownership.sql': '349669b16ea17b3fe13c31ebceed8e7aa1f144fb35967451a883946823b664dc',
  '0005_auth_rate_limit.sql': 'a527d321edb786d679418c12a17a800c77180f7d6d7f60ab3c2464d7a167c650',
};
export function migrationHashes() {
  return Object.fromEntries(readdirSync(resolve(projectRoot, 'migrations')).filter(n => n.endsWith('.sql')).sort()
    .map(n => [n, digest(readFileSync(resolve(projectRoot, 'migrations', n), 'utf8').replace(/\r\n/g, '\n'))]));
}
const normalized = (sql: string | null) => sql?.replace(/\r\n/g, '\n').trim() ?? null;
export class LocalImportDatabase implements ImportDatabase {
  readonly kind: 'local' | 'fake-remote' = 'local';
  readonly local = new LocalDatabase(':memory:'); // No file path accepted: cannot open operational DB.
  batches = 0;
  constructor(readonly identifier = 'local-stage3d-synthetic') {}
  prepare(sql: string, params: BoundStatement['params'] = []): BoundStatement {
    return Object.freeze({ sql, params: Object.freeze([...params]) });
  }
  async batch(statements: readonly BoundStatement[]) {
    this.batches++;
    if (this.local.sqlite.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1) reject('FOREIGN_KEYS_DISABLED');
    try { await this.local.batch(statements.map(s => ({ sql: s.sql, params: [...s.params] }))); }
    catch { reject('BATCH_REJECTED_OR_UNKNOWN'); } // SQLite errors can contain table/values: never forward.
  }
  inspect(): Inspection {
    const sql = this.local.sqlite;
    const schema = (sql.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all() as SchemaRow[])
      .map(r => ({ ...r, sql: normalized(r.sql) }));
    const n = (table: string) => Number(sql.prepare(`SELECT count(*) AS n FROM "${table}"`).get()?.n);
    const business = Object.fromEntries(tables.map(t => [t, sql.prepare(`SELECT * FROM ${t}`).all()])) as Record<string, Row[]>;
    const accounts = sql.prepare('SELECT userId,accountId,providerId,(password IS NOT NULL AND length(password)>0) AS credentialPresent FROM account ORDER BY id').all()
      .map(r => ({ userId: String(r.userId), accountId: String(r.accountId), providerId: String(r.providerId), credentialPresent: Boolean(r.credentialPresent) }));
    const authRows = ['user', 'account', 'session', 'verification', 'rateLimit'].map(t => sql.prepare(`SELECT * FROM "${t}" ORDER BY id`).all());
    const authFingerprint = digest(JSON.stringify(authRows)); // internal only, never emitted in evidence.
    return { identifier: this.identifier, schema, schemaFingerprint: digest(JSON.stringify(schema)),
      triggerFingerprint: digest(JSON.stringify(schema.filter(r => r.type === 'trigger'))),
      migrations: sql.prepare('SELECT name FROM _migrations ORDER BY name').all().map(r => String(r.name)), migrationHashes: migrationHashes(),
      counts: Object.fromEntries(tables.map(t => [t, n(t)])) as Counts, business,
      users: sql.prepare('SELECT id,email FROM user ORDER BY id').all() as Owner[], accounts,
      sessions: n('session'), verification: n('verification'), rateLimit: n('rateLimit'),
      fkClean: sql.prepare('PRAGMA foreign_key_check').all().length === 0,
      foreignKeys: sql.prepare('PRAGMA foreign_keys').get()?.foreign_keys === 1,
      authFingerprint, settled: true };
  }
  readSchemaFingerprint() { return this.inspect().schemaFingerprint; }
  readTriggerFingerprint() { return this.inspect().triggerFingerprint; }
  readCounts() { return this.inspect().counts; }
  close() { this.local.close(); }
}
// Fake remote means in-memory SQLite test double, never network-capable.
export class FakeRemoteImportDatabase extends LocalImportDatabase { override readonly kind = 'fake-remote' as const; }
export function openRemoteImportDatabase(): never { return reject('REMOTE_IMPORT_NOT_IMPLEMENTED'); }
export interface OwnerBootstrapAdapter {
  signup(): Promise<Owner>; logout(): Promise<void>; inspectOwnerState(): Inspection;
}
// Models bootstrap relations only; does NOT claim to exercise Better Auth or a real signup.
export class FakeLoopbackAuthAdapter implements OwnerBootstrapAdapter {
  constructor(private readonly db: LocalImportDatabase) {}
  async signup(): Promise<Owner> {
    const owner = { id: 'stage3d-fixture-owner', email: 'stage3d@example.invalid' };
    const t = '2026-10-01T00:00:00.000Z';
    await this.db.batch([
      this.db.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,?,?)', [owner.id, 'Synthetic fixture', owner.email, t, t]),
      this.db.prepare('INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)', ['fixture-account', owner.id, 'credential', owner.id, Buffer.from(randomBytes(32)).toString('hex'), t, t]),
      this.db.prepare('INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES (?,?,?,?,?,?)', ['fixture-session', t, Buffer.from(randomBytes(32)).toString('hex'), t, t, owner.id]),
    ]);
    return owner;
  }
  async logout() { await this.db.batch([this.db.prepare('DELETE FROM session')]); }
  inspectOwnerState() { return this.db.inspect(); }
}
export function trustedBaseline() {
  if (JSON.stringify(migrationHashes()) !== JSON.stringify(APPROVED_MIGRATIONS)) reject('MIGRATION_HASH_MISMATCH');
  const db = new LocalImportDatabase(); try { return db.inspect(); } finally { db.close(); }
}
