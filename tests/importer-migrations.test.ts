import { beforeEach, afterEach, expect, it, vi } from 'vitest';

// Alter only this isolated module's migration reads; repository files never change.
const view = vi.hoisted(() => ({ mode: 'normal', file: '' }));
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const { resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const directory = resolve(fileURLToPath(new URL('../migrations', import.meta.url)));
  const readdir = fs.readdirSync as (path: unknown, options?: unknown) => unknown[];
  const read = fs.readFileSync as (path: unknown, options?: unknown) => unknown;
  return { ...fs,
    readdirSync: (path: unknown, options?: unknown) => {
      const result = readdir(path, options);
      if (typeof path !== 'string' || resolve(path) !== directory) return result;
      if (view.mode === 'missing') return result.filter(name => name !== '0006_account_deletion.sql');
      return view.mode === 'extra' ? [...result, '0007_unapproved.sql'] : result;
    },
    readFileSync: (path: unknown, options?: unknown) => {
      const migration = typeof path === 'string' && resolve(path).startsWith(directory + '\\');
      if (migration && String(path).endsWith('0007_unapproved.sql')) return 'SELECT 1;';
      const result = read(path, options);
      if (!migration || typeof result !== 'string') return result;
      if (view.mode === 'invalid' && String(path).endsWith('0006_account_deletion.sql')) return 'CREATE TABLE unsafe(id TEXT);';
      if (view.mode === 'tampered' && String(path).endsWith(view.file)) return result + '\n-- unapproved alteration\n';
      return view.mode === 'crlf' ? result.replace(/\r?\n/g, '\r\n') : result;
    },
  };
});
import { APPROVED_MIGRATIONS, trustedBaseline, LocalImportDatabase, FakeLoopbackAuthAdapter } from '../scripts/stage3d/adapters.ts';
import { loadBytes } from '../scripts/stage3d/source.ts';
import { runPreflight } from '../scripts/stage3d/preflight.ts';
import { generatePlan, executeLocalPlan, classifyOutcome } from '../scripts/stage3d/import-plan.ts';
import { encoded, simulationPolicy } from './stage3d-fixtures.ts';
let db: LocalImportDatabase | undefined;
beforeEach(() => { view.mode = 'normal'; view.file = ''; });
afterEach(() => { db?.close(); db = undefined; view.mode = 'normal'; });
it('trusts exactly six approved migrations, including marker FK and all 17 trigger definitions', () => {
  const baseline = trustedBaseline();
  expect(baseline.migrations).toEqual(Object.keys(APPROVED_MIGRATIONS));
  expect(baseline.migrations.length).toBe(6);
  expect(baseline.schema.filter(row => row.type === 'trigger').length).toBe(17);
  expect(baseline.schema.find(row => row.name === '_account_deletion_scope')?.sql).toContain('ON DELETE CASCADE');
  for (const name of ['plan_versions_immutable_delete', 'execution_preserve_delete', 'task_identity_immutable']) {
    expect(baseline.schema.find(row => row.name === name)?.sql).toContain('_account_deletion_scope');
  }
});
it.each(['missing', 'extra', 'invalid'])('rejects %s migration 0006/directory state', mode => {
  view.mode = mode; expect(() => trustedBaseline()).toThrow('MIGRATION_HASH_MISMATCH');
});
it.each(Object.keys(APPROVED_MIGRATIONS))('rejects altered bytes of %s', file => {
  view.mode = 'tampered'; view.file = file;
  expect(() => trustedBaseline()).toThrow('MIGRATION_HASH_MISMATCH');
});
it('preserves CRLF-to-LF hash/schema normalization', () => {
  const baseline = trustedBaseline(); view.mode = 'crlf';
  expect(trustedBaseline().schemaFingerprint === baseline.schemaFingerprint).toBe(true);
});
async function fixture() {
  db = new LocalImportDatabase(); const auth = new FakeLoopbackAuthAdapter(db);
  const owner = await auth.signup(); await auth.logout();
  const fixture = encoded(); const source = loadBytes(fixture.bytes, fixture.sha);
  return { source, owner, policy: simulationPolicy(owner, fixture.sha) };
}
it('normal six-migration empty business schema passes all local preflight checks', async () => {
  const { source, policy } = await fixture();
  expect(runPreflight(source, db!.inspect(), policy).allowed).toBe(true);
});
it.each(['missing marker', 'altered deletion trigger', 'missing applied 0006', 'extra applied migration', 'active deletion marker'])('rejects target with %s', async fault => {
  const { source, owner, policy } = await fixture();
  const sql = db!.local.sqlite;
  if (fault === 'missing marker') sql.exec('DROP TABLE _account_deletion_scope');
  if (fault === 'altered deletion trigger') sql.exec("DROP TRIGGER execution_preserve_delete; CREATE TRIGGER execution_preserve_delete BEFORE DELETE ON execution_logs BEGIN SELECT RAISE(ABORT,'changed'); END;");
  if (fault === 'missing applied 0006') sql.exec("DELETE FROM _migrations WHERE name='0006_account_deletion.sql'");
  if (fault === 'extra applied migration') sql.exec("INSERT INTO _migrations VALUES('0007_unapproved.sql','fixture')");
  if (fault === 'active deletion marker') sql.prepare('INSERT INTO _account_deletion_scope VALUES(?)').run(owner.id);
  // A missing guard table may make inspection fail; both outcomes are fail closed.
  let rejected = false;
  try { rejected = !runPreflight(source, db!.inspect(), policy).allowed; } catch { rejected = true; }
  expect(rejected).toBe(true);
});
it('a deletion marker appearing after preflight aborts the import batch with no business writes', async () => {
  const { source, owner, policy } = await fixture();
  const plan = generatePlan(db!, source, policy);
  db!.local.sqlite.prepare('INSERT INTO _account_deletion_scope VALUES(?)').run(owner.id);
  await expect(executeLocalPlan(db!, plan)).rejects.toThrow();
  expect(Object.values(db!.inspect().counts).every(n => n === 0)).toBe(true);
});
it('unknown-outcome classification refuses an active account-deletion scope', async () => {
  const { source, owner } = await fixture(); const before = db!.inspect();
  db!.local.sqlite.prepare('INSERT INTO _account_deletion_scope VALUES(?)').run(owner.id);
  expect(classifyOutcome(db!.inspect(), before, source, owner.id)).toBe('UNEXPECTED_PARTIAL_OR_UNKNOWN');
});
