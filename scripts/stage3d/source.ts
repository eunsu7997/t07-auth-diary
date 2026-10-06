// Node-only offline tooling. Never imported by application/Worker entry points.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { validateLegacy, tables, type Legacy } from '../import-t06-local.ts';
export { tables, type Legacy };
export type Row = Record<string, string | number | null>;
export const ACTUAL_SHA = '85ffe223f09c99d781e39aa631d213a2997bfacffb96d0e18df964c5f4faf9d3';
export const DEFAULT_SOURCE = 'C:/Users/User/Downloads/t06-diary.json';
export const contract = JSON.parse(readFileSync(new URL('../../contracts/pds-schema-v2.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: false }); addFormats(ajv);
const schemaValid = ajv.compile(contract);
export const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const reject = (code: string): never => { throw new Error(code); };
export type Counts = Record<typeof tables[number], number>;
export const countsOf = (data: Legacy): Counts => Object.fromEntries(tables.map(t => [t, data[t].length])) as Counts;
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const loadedSources = new WeakSet<object>();
export type Source = Readonly<{ sha: string; data: Legacy; counts: Counts; taskStages: Row[][] }>;
export function isLoaded(source: Source) { return loadedSources.has(source); }
// No supplied JSON is ever interpolated into errors. Hash is checked before parsing.
export function loadBytes(bytes: Uint8Array, allowedSha: string): Source {
  const sha = digest(bytes); if (sha !== allowedSha) reject('SOURCE_HASH_MISMATCH');
  let input: unknown;
  try { input = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { reject('SOURCE_SCHEMA_INVALID'); }
  if (!schemaValid(input)) reject('SOURCE_SCHEMA_INVALID');
  try { validateLegacy(input); } catch { reject('SOURCE_RELATION_INVALID'); }
  const data = input as Legacy;
  for (const table of tables) for (const keys of contract['x-database'][table].unique as string[][]) {
    const values = data[table].filter(r => keys.every(k => r[k] !== null)).map(r => JSON.stringify(keys.map(k => r[k])));
    if (new Set(values).size !== values.length) reject('SOURCE_RELATION_INVALID');
  }
  if (data.plan_versions.some(v => String(v.period_end) < String(v.period_start) || !String(v.title).trim() || !String(v.success_criteria).trim()) ||
      data.tasks.some(t => !String(t.content).trim()) || data.tags.some(t => !String(t.name).trim())) reject('SOURCE_RELATION_INVALID');
  // Approved trigger-safe strategy: closed logs only; copy sources completed/non-archived.
  if (data.execution_logs.some(e => e.ended_at === null)) reject('SOURCE_STRATEGY_UNSUPPORTED');
  const pending = [...data.tasks]; const inserted = new Set<unknown>(); const taskStages: Row[][] = [];
  while (pending.length) {
    const stage = pending.filter(t => t.copied_from_task_id === null || inserted.has(t.copied_from_task_id));
    if (!stage.length) reject('SOURCE_RELATION_INVALID');
    for (const t of stage) {
      if (t.copied_from_task_id !== null && !data.tasks.some(s => s.id === t.copied_from_task_id && s.status === 'completed' && s.deleted_at === null)) reject('SOURCE_STRATEGY_UNSUPPORTED');
      inserted.add(t.id); pending.splice(pending.indexOf(t), 1);
    }
    taskStages.push(stage);
  }
  const source = freeze({ sha, data, counts: countsOf(data), taskStages }); loadedSources.add(source); return source;
}
export function loadSource(path = DEFAULT_SOURCE, allowedSha = ACTUAL_SHA): Source {
  let bytes: Buffer;
  try { bytes = readFileSync(path); } catch { return reject('SOURCE_READ_FAILED'); }
  try { return loadBytes(bytes, allowedSha); } finally { bytes.fill(0); }
}
