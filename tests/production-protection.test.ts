import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, lstatSync } from 'node:fs';
vi.mock('node:fs', async original => { const actual = await original<typeof import('node:fs')>(); return { ...actual, readFileSync: vi.fn(actual.readFileSync), lstatSync: vi.fn(actual.lstatSync) }; });
import { normalizeTarget, type TargetPolicy } from '../scripts/stage3e2a/transport.ts';
const original = await vi.importActual<typeof import('node:fs')>('node:fs');
const snapshotPath = new URL('../scripts/production-protection.json', import.meta.url);
const currentConfigPath = new URL('../wrangler.jsonc', import.meta.url);
const t06Id = JSON.parse(original.readFileSync(snapshotPath, 'utf8')).database_id as string;
const t07Id = JSON.parse(original.readFileSync(currentConfigPath, 'utf8')).d1_databases[0].database_id as string;
const policy = (): TargetPolicy => ({ purpose: 'DISPOSABLE_TEST', expectedDatabaseId: crypto.randomUUID(), expectedAccountId: crypto.randomUUID().replaceAll('-', ''), expectedName: 'aleph-t07-disposable-protection-fixture', deniedDatabaseIds: [crypto.randomUUID()], explicitConfirmation: true });
const code = (value: string) => Object.assign(new Error('SYNTHETIC_FS_FAILURE'), { code: value });
const missingSibling = () => vi.mocked(lstatSync).mockImplementation(() => { throw code('ENOENT'); });
afterEach(() => { vi.mocked(readFileSync).mockImplementation(original.readFileSync); vi.mocked(lstatSync).mockImplementation(original.lstatSync); });
describe('standalone repository protection', () => {
  it('no sibling permits disposable but protects historical T06 and current T07', () => {
    missingSibling(); const p = policy(), normalized = normalizeTarget(p);
    expect(normalized.deniedDatabaseIds.includes(t06Id)).toBe(true); expect(normalized.deniedDatabaseIds.includes(t07Id)).toBe(true);
    for (const id of [t06Id, t07Id]) expect(() => normalizeTarget({ ...p, expectedDatabaseId: id })).toThrow('TARGET_DENIED');
  });
  it('existing sibling additional binding is included', () => {
    const extra = crypto.randomUUID(); vi.mocked(lstatSync).mockReturnValue({ isDirectory: () => true } as never);
    vi.mocked(readFileSync).mockImplementation(((path: unknown, options: unknown) => String(path).includes('/t06/wrangler.jsonc') ? JSON.stringify({ d1_databases: [{ database_id: extra }] }) : original.readFileSync(path as never, options as never)) as typeof readFileSync);
    expect(() => normalizeTarget({ ...policy(), expectedDatabaseId: extra })).toThrow('TARGET_DENIED');
  });
  it('valid sibling JSONC comments/trailing commas preserve additional protection', () => {
    const extra = crypto.randomUUID(); vi.mocked(lstatSync).mockReturnValue({ isDirectory: () => true } as never);
    vi.mocked(readFileSync).mockImplementation(((path: unknown, options: unknown) => String(path).includes('/t06/wrangler.jsonc') ? `{// comment\n"d1_databases":[{"database_id":"${extra}",},],}` : original.readFileSync(path as never, options as never)) as typeof readFileSync);
    expect(() => normalizeTarget({ ...policy(), expectedDatabaseId: extra })).toThrow('TARGET_DENIED');
  });
  it.each(['ENOENT', 'EACCES'])('existing folder config %s remains fail closed', failure => {
    vi.mocked(lstatSync).mockReturnValue({ isDirectory: () => true } as never);
    vi.mocked(readFileSync).mockImplementation(((path: unknown, options: unknown) => { if (String(path).includes('/t06/wrangler.jsonc')) throw code(failure); return original.readFileSync(path as never, options as never); }) as typeof readFileSync);
    expect(() => normalizeTarget(policy())).toThrow('PRODUCTION_PROTECTION_UNKNOWN');
  });
  it('folder access error is not treated as absence', () => { vi.mocked(lstatSync).mockImplementation(() => { throw code('EACCES'); }); expect(() => normalizeTarget(policy())).toThrow('PRODUCTION_PROTECTION_UNKNOWN'); });
  it.each(['snapshot missing', 'snapshot corrupt', 'snapshot invalid id', 'current config missing', 'current config invalid id', 'current config corrupt'])('%s fails closed even without sibling', failure => {
    missingSibling(); vi.mocked(readFileSync).mockImplementation(((path: unknown, options: unknown) => {
      const text = String(path);
      if (text.endsWith('production-protection.json')) {
        if (failure === 'snapshot missing') throw code('ENOENT');
        if (failure === 'snapshot corrupt') return '{';
        if (failure === 'snapshot invalid id') return JSON.stringify({ source: 'DEPLOYMENT.md:T06', database_name: 'aleph-t06-pds-diary-db', database_id: 'invalid' });
      }
      if (text === String(currentConfigPath)) {
        if (failure === 'current config missing') throw code('ENOENT');
        if (failure === 'current config invalid id') return '{"database_id":"invalid"}';
        if (failure === 'current config corrupt') return '{"d1_databases":[{"database_id":"' + t07Id + '"}]';
      }
      return original.readFileSync(path as never, options as never);
    }) as typeof readFileSync); expect(() => normalizeTarget(policy())).toThrow('PRODUCTION_PROTECTION_UNKNOWN');
  });
});
