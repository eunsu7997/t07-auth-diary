import { vi } from 'vitest';

// These import suites test the previously approved Stage3B 0001..0005 target,
// not the new account-deletion schema. Filter ONLY this new migration in their
// isolated test-module filesystem view. Existing migration bytes/hashes, runtime
// guards and all assertions are unchanged. No production module uses this file.
// account-deletion.test.ts uses the complete schema and independently confirms
// that the old importer still rejects migration 0006 without a new audit.
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const { fileURLToPath } = await import('node:url');
  const { resolve } = await import('node:path');
  const directory = resolve(fileURLToPath(new URL('../migrations', import.meta.url)));
  const read = actual.readdirSync as (path: unknown, options?: unknown) => unknown[];
  return { ...actual, readdirSync: (path: unknown, options?: unknown) => {
    const entries = read(path, options);
    return typeof path === 'string' && resolve(path) === directory
      ? entries.filter(entry => entry !== '0006_account_deletion.sql') : entries;
  } };
});
