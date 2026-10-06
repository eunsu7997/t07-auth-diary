import { account } from './fixtures.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { LocalDatabase } from '../src/server/local-db.ts';
import { Diary } from '../src/server/services.ts';

const schema = JSON.parse(readFileSync(new URL('../contracts/pds-schema-v3.json', import.meta.url), 'utf8'));
let fixture: Awaited<ReturnType<typeof account>>; let db: LocalDatabase;
beforeEach(async () => { db = new LocalDatabase(':memory:'); fixture = await account(db); });
afterEach(() => db.close());
const tables = Object.keys(schema['x-database']);

describe('database and JSON schema correspondence', () => {
  it('matches every business table, field, SQL type, nullability, primary key, relation and unique constraint', () => {
    const business = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB '_*' AND name NOT IN ('user','account','session','verification')").all().map(r => r.name).sort();
    expect(business).toEqual([...tables].sort());
    for (const table of tables) {
      const metadata = schema['x-database'][table];
      const columns = db.sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string; notnull: number; pk: number }[];
      expect(columns.map(c => c.name).sort()).toEqual(Object.keys(schema.$defs[table].properties).sort());
      expect([...schema.$defs[table].required].sort()).toEqual(columns.map(c => c.name).sort());
      expect(columns.filter(c => c.pk).sort((a, b) => a.pk - b.pk).map(c => c.name)).toEqual(metadata.primary_key);
      expect(columns.filter(c => !c.notnull).map(c => c.name).sort()).toEqual([...metadata.nullable].sort());
      expect(columns.filter(c => c.type === 'INTEGER').map(c => c.name).sort()).toEqual([...metadata.integer_columns].sort());
      expect(columns.every(c => c.type === 'INTEGER' || c.type === 'TEXT')).toBe(true);
      const fks = db.sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all() as { from: string; table: string; to: string }[];
      const fkSignature = (f: { column: string; table: string; target: string }) => `${f.column}:${f.table}:${f.target}`;
      expect(fks.map(f => fkSignature({ column: f.from, table: f.table, target: f.to })).sort()).toEqual(metadata.foreign_keys.map(fkSignature).sort());
      const indexes = db.sqlite.prepare(`PRAGMA index_list(${table})`).all() as { name: string; unique: number; origin: string }[];
      const unique = indexes.filter(i => i.unique && i.origin === 'u').map(i => db.sqlite.prepare(`PRAGMA index_info(${i.name})`).all().map(c => c.name).join(',')).sort();
      expect(unique).toEqual(metadata.unique.map((u: string[]) => u.join(',')).sort());
    }
    const index = db.sqlite.prepare("SELECT sql FROM sqlite_master WHERE name = 'execution_one_active_per_task'").get();
    expect(index?.sql).toContain('WHERE ended_at IS NULL');
    const triggers = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all().map(row => row.name).sort();
    expect(triggers).toEqual([...schema['x-triggers']].sort());
    const partial = schema['x-database'].execution_logs.partial_unique[0];
    expect(partial.columns).toEqual(db.sqlite.prepare(`PRAGMA index_info(${partial.name})`).all().map(row => row.name));
    expect(index?.sql).toContain(partial.predicate);
  });
  it('validates actual DB rows, including all plan versions and task-tag joins, against the contract', async () => {
    const diary = new Diary(db, fixture.userId);
    const original = { title: '계약 테스트', period_start: '2026-10-02', period_end: '2026-10-04', success_criteria: '계약 검증', estimated_seconds: 1800 };
    const plan = await diary.createPlan(original);
    await diary.updatePlan(plan.id, { ...original, title: '수정된 계약 테스트' }, 1);
    const task = await diary.createTask(plan.id, { content: '할 일', priority: 'high', tags: ['테스트'], due_date: null, estimated_seconds: 60 });
    await diary.deleteTask(task.id);
    const data = await diary.exportAll();
    const ajv = new Ajv2020({ strict: false, allErrors: true }); addFormats(ajv);
    const validate = ajv.compile(schema);
    expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
    expect((data.plan_versions as unknown[]).length).toBe(2);
    expect((data.task_tags as unknown[]).length).toBe(1);
    (data.tasks as { estimated_seconds: number }[])[0].estimated_seconds = -1;
    expect(validate(data)).toBe(false);
  });
  it('DB enforces execution foreign keys, active-log uniqueness and completion consistency', async () => {
    const diary = new Diary(db, fixture.userId);
    const plan = await diary.createPlan({ title: '제약 테스트', period_start: '2026-10-02', period_end: '2026-10-04', success_criteria: 'DB 제약', estimated_seconds: 120 });
    const task = await diary.createTask(plan.id, { content: '제약 할 일', priority: 'low', due_date: null, estimated_seconds: 60, tags: [] });
    const insert = db.sqlite.prepare('INSERT INTO execution_logs (id, task_id, started_at, estimated_seconds_at_start, start_request_id) VALUES (?, ?, ?, ?, ?)');
    insert.run('log-a', task.id, '2026-10-02T00:00:00.000Z', 60, 'request-a');
    expect(() => insert.run('log-b', task.id, '2026-10-02T00:00:01.000Z', 60, 'request-b')).toThrow();
    expect(() => insert.run('log-c', 'missing', '2026-10-02T00:00:01.000Z', 60, 'request-c')).toThrow();
    expect(() => db.sqlite.prepare('UPDATE execution_logs SET ended_at = ? WHERE id = ?').run('2026-10-02T00:01:00.000Z', 'log-a')).toThrow();
    expect((await diary.task(task.id)).estimated_seconds).toBe(60);
  });
});
