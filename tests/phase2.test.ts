import { account } from './fixtures.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { LocalDatabase } from '../src/server/local-db.ts';
import { Diary } from '../src/server/services.ts';
import { createApp } from '../src/server/app.ts';
import type { Database, Statement } from '../src/server/db.ts';
import type { DatabaseExport, ExecutionLog, PlanInput, TaskInput } from '../src/shared/types.ts';

// Every fixture lives only in this test's temporary SQLite database.
const planInput: PlanInput = { title: '2차 테스트 전용', period_start: '2026-10-01', period_end: '2026-10-09', success_criteria: '자동 검증 전용', estimated_seconds: 9999 };
const taskInput: TaskInput = { content: '2차 테스트 할 일', priority: 'high', due_date: '2026-10-02', estimated_seconds: 600, tags: ['테스트', '학습'] };
let fixture: Awaited<ReturnType<typeof account>>; let db: LocalDatabase; let diary: Diary; let directory: string; let clock: string;
const id = () => crypto.randomUUID();
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 't06-phase2-'));
  db = new LocalDatabase(join(directory, 'test.sqlite')); fixture = await account(db);
  clock = '2026-10-02T03:00:00.500Z'; diary = new Diary(db, fixture.userId, () => clock);
});
afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
async function makeTask(input: Partial<TaskInput> = {}, planId?: string) {
  const parent = planId ?? (await diary.createPlan(planInput)).id;
  return diary.createTask(parent, { ...taskInput, ...input });
}
async function complete(taskId: string, seconds = 60) {
  const log = await diary.start(taskId, id());
  clock = new Date(Date.parse(clock) + seconds * 1000).toISOString();
  return diary.finish(taskId, log.id, id());
}

describe('execution state, durability and idempotency', () => {
  it('start creates one linked open log immediately with server time and a separate estimate snapshot', async () => {
    const task = await makeTask(); const log = await diary.start(task.id, id());
    expect(log).toMatchObject({ task_id: task.id, started_at: clock, ended_at: null, actual_seconds: null, estimated_seconds_at_start: 600, finish_request_id: null });
    expect(await db.all('SELECT * FROM execution_logs')).toHaveLength(1);
    expect((await diary.task(task.id)).estimated_seconds).toBe(600);
  });
  it('same start request and simultaneous different start requests return the one open log', async () => {
    const task = await makeTask(); const key = id();
    const [first, repeated, ...parallel] = await Promise.all([diary.start(task.id, key), diary.start(task.id, key), ...Array.from({ length: 20 }, () => diary.start(task.id, id()))]);
    expect([repeated, ...parallel].every(log => log.id === first.id)).toBe(true);
    expect(await db.all('SELECT * FROM execution_logs')).toHaveLength(1);
  });
  it('open execution survives new app instances and closing/reopening the server DB', async () => {
    const task = await makeTask(); const log = await diary.start(task.id, id());
    const app = fixture.authenticatedApp(db);
    expect(await (await app.request(`/api/tasks/${task.id}/executions`)).json()).toEqual([log]);
    db.close(); db = new LocalDatabase(join(directory, 'test.sqlite')); diary = new Diary(db, fixture.userId, () => clock);
    expect(await diary.executions(task.id)).toEqual([log]);
    expect((await diary.task(task.id)).status).toBe('in_progress');
  });
  it('finish stores precise start/end, floors elapsed milliseconds, and never changes task or plan estimates', async () => {
    const task = await makeTask(); const log = await diary.start(task.id, id());
    clock = '2026-10-02T03:01:05.999Z';
    const closed = await diary.finish(task.id, log.id, id());
    expect(closed.started_at).toBe('2026-10-02T03:00:00.500Z'); expect(closed.ended_at).toBe(clock); expect(closed.actual_seconds).toBe(65);
    expect(await diary.task(task.id)).toMatchObject({ status: 'completed', completed_at: clock, estimated_seconds: 600 });
    expect((await diary.plan(task.plan_id)).estimated_seconds).toBe(9999);
  });
  it('zero/sub-second execution is valid and does not round up', async () => {
    const task = await makeTask(); clock = '2026-10-02T03:00:00.900Z'; const log = await diary.start(task.id, id());
    clock = '2026-10-02T03:00:01.100Z';
    expect((await diary.finish(task.id, log.id, id())).actual_seconds).toBe(0);
  });
  it('twenty finish clicks with different request IDs close the same log exactly once', async () => {
    const task = await makeTask(); const log = await diary.start(task.id, id()); clock = '2026-10-02T03:02:00.500Z';
    const results = await Promise.all(Array.from({ length: 20 }, () => diary.finish(task.id, log.id, id())));
    expect(results.every(result => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(true);
    expect(results[0].actual_seconds).toBe(120);
    expect(await db.all('SELECT * FROM execution_logs')).toHaveLength(1);
  });
  it('same finish request retry preserves the first end time, duration, and finish key', async () => {
    const task = await makeTask(); const log = await diary.start(task.id, id()); const key = id();
    clock = '2026-10-02T03:01:00.500Z'; const closed = await diary.finish(task.id, log.id, key);
    clock = '2026-10-02T05:00:00.000Z';
    expect(await diary.finish(task.id, log.id, key)).toEqual(closed);
    expect(await diary.finish(task.id, log.id, id())).toEqual(closed);
    expect((await diary.task(task.id)).completed_at).toBe(closed.ended_at);
  });
  it('reopen preserves every previous execution and actual duration; next start has a new ID', async () => {
    const task = await makeTask(); const closed = await complete(task.id, 90);
    expect(await diary.reopen(task.id)).toMatchObject({ status: 'in_progress', completed_at: null, estimated_seconds: 600 });
    expect(await diary.executions(task.id)).toEqual([closed]);
    const second = await diary.start(task.id, id()); expect(second.id).not.toBe(closed.id);
    const both = await diary.executions(task.id); expect(both).toHaveLength(2); expect(both.find(e => e.id === closed.id)).toEqual(closed);
    clock = new Date(Date.parse(clock) + 30000).toISOString();
    await diary.finish(task.id, second.id, id());
    expect((await diary.review()).actual_seconds).toBe(120);
    expect((await diary.review()).completed_count).toBe(1);
  });
  it('delayed old finish retry never finishes a new execution or re-completes a reopened task', async () => {
    const task = await makeTask(); const closed = await complete(task.id, 90);
    await diary.reopen(task.id);
    expect(await diary.finish(task.id, closed.id, closed.finish_request_id!)).toEqual(closed);
    expect((await diary.task(task.id)).status).toBe('in_progress');
    const next = await diary.start(task.id, id());
    expect(await diary.finish(task.id, closed.id, id())).toEqual(closed);
    expect((await diary.executions(task.id)).find(e => e.id === next.id)?.ended_at).toBeNull();
    expect((await diary.task(task.id)).status).toBe('in_progress');
  });
  it('request IDs cannot be reused across unrelated tasks/executions', async () => {
    const a = await makeTask(); const b = await makeTask(); const startKey = id(); const first = await diary.start(a.id, startKey);
    await expect(diary.start(b.id, startKey)).rejects.toMatchObject({ status: 409 });
    const second = await diary.start(b.id, id()); clock = new Date(Date.parse(clock) + 5000).toISOString(); const finishKey = id();
    await diary.finish(a.id, first.id, finishKey);
    await expect(diary.finish(b.id, second.id, finishKey)).rejects.toMatchObject({ status: 409 });
    expect((await diary.executions(b.id))[0].ended_at).toBeNull();
  });
  it('rejects finishing an unrelated/missing log and starting a completed task', async () => {
    const task = await makeTask(); await expect(diary.finish(task.id, id(), id())).rejects.toMatchObject({ status: 404 });
    const closed = await complete(task.id);
    await expect(diary.start(task.id, id())).rejects.toMatchObject({ status: 409 });
    expect(await diary.start(task.id, closed.start_request_id)).toEqual(closed);
    expect(await db.all('SELECT * FROM execution_logs')).toHaveLength(1);
  });
  it('DB refuses closed log updates/deletes and active log identity changes', async () => {
    const task = await makeTask(); const open = await diary.start(task.id, id());
    expect(() => db.sqlite.prepare('UPDATE execution_logs SET started_at = ? WHERE id = ?').run('2026-10-02T01:00:00.000Z', open.id)).toThrow('identity');
    clock = '2026-10-02T03:01:00.500Z'; const closed = await diary.finish(task.id, open.id, id());
    expect(() => db.sqlite.prepare('UPDATE execution_logs SET actual_seconds = ? WHERE id = ?').run(999, closed.id)).toThrow('immutable');
    expect(() => db.sqlite.prepare('DELETE FROM execution_logs WHERE id = ?').run(closed.id)).toThrow('preserved');
    expect(await diary.executions(task.id)).toEqual([closed]);
  });
  it('DB duration mismatch rolls back both the log and task status', async () => {
    const task = await makeTask(); const open = await diary.start(task.id, id());
    expect(() => db.sqlite.prepare('UPDATE execution_logs SET ended_at = ?, actual_seconds = ?, finish_request_id = ? WHERE id = ?').run('2026-10-02T03:01:00.500Z', 999, id(), open.id)).toThrow('duration');
    expect(await diary.executions(task.id)).toEqual([open]); expect((await diary.task(task.id)).status).toBe('in_progress');
  });
  it('backwards server clock is rejected without corrupting the open log', async () => {
    const task = await makeTask(); const open = await diary.start(task.id, id()); clock = '2026-10-02T02:59:00.000Z';
    await expect(diary.finish(task.id, open.id, id())).rejects.toMatchObject({ status: 409 });
    expect(await diary.executions(task.id)).toEqual([open]);
  });
  it('open tasks cannot be deleted; archived completed tasks retain logs and remain in review', async () => {
    const task = await makeTask(); const open = await diary.start(task.id, id());
    await expect(diary.deleteTask(task.id)).rejects.toMatchObject({ status: 409 });
    expect(() => db.sqlite.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ?').run(clock, task.id)).toThrow('active');
    clock = new Date(Date.parse(clock) + 10000).toISOString(); await diary.finish(task.id, open.id, id()); await diary.deleteTask(task.id);
    const review = await diary.review(task.plan_id);
    expect(review.actual_seconds).toBe(10); expect(review.task_estimated_seconds).toBe(600); expect(review.completed_count).toBe(1);
    expect(review.evidence.completed_tasks[0].deleted_at).not.toBeNull();
  });
});

describe('review counts, sums and Korean date boundaries', () => {
  it('returns zero metrics for an empty database', async () => {
    expect(await diary.review()).toMatchObject({ plan_count: 0, completed_count: 0, delayed_count: 0, plan_estimated_seconds: 0, task_estimated_seconds: 0, actual_seconds: 0, difference_seconds: 0 });
  });
  it('aggregates DB evidence exactly and separates plan estimates from task estimates', async () => {
    const p1 = await diary.createPlan(planInput); const p2 = await diary.createPlan({ ...planInput, estimated_seconds: 20000 });
    await makeTask({ content: '미완료 지연', due_date: '2026-10-01', estimated_seconds: 60 }, p1.id);
    const b = await makeTask({ content: '당일 완료', estimated_seconds: 120 }, p1.id); await complete(b.id, 90);
    const c = await makeTask({ content: '늦게 완료', due_date: '2026-10-01', estimated_seconds: 180 }, p1.id); await complete(c.id, 10);
    const d = await makeTask({ content: '마감 없음 진행 중', due_date: null, estimated_seconds: 240 }, p1.id); await diary.start(d.id, id());
    await makeTask({ content: '다른 계획', due_date: '2026-10-03', estimated_seconds: 300 }, p2.id);
    const review = await diary.review(p1.id);
    expect(review).toMatchObject({ plan_count: 1, completed_count: 2, delayed_count: 2, plan_estimated_seconds: 9999, task_estimated_seconds: 600, actual_seconds: 100, difference_seconds: -500 });
    expect(review.evidence.closed_executions).toHaveLength(2); expect(review.evidence.active_executions).toHaveLength(1);
    expect(review.evidence.delayed_tasks.map(t => t.content).sort()).toEqual(['늦게 완료', '미완료 지연'].sort());
    expect(await diary.review()).toMatchObject({ plan_count: 2, task_estimated_seconds: 900, actual_seconds: 100, difference_seconds: -800, plan_estimated_seconds: 29999 });
    const [sum] = await db.all<{ total: number }>('SELECT SUM(estimated_seconds) AS total FROM tasks WHERE plan_id = ?', [p1.id]);
    expect(review.task_estimated_seconds).toBe(sum.total);
  });
  it('completion before Korean midnight is on time, while midnight of the next day is late', async () => {
    const a = await makeTask(); const b = await makeTask();
    clock = '2026-10-02T14:59:00.000Z'; const first = await diary.start(a.id, id()); const second = await diary.start(b.id, id());
    clock = '2026-10-02T14:59:59.999Z'; await diary.finish(a.id, first.id, id());
    clock = '2026-10-02T15:00:00.000Z'; await diary.finish(b.id, second.id, id());
    const review = await diary.review(); expect(review.today).toBe('2026-10-03');
    expect(review.delayed_count).toBe(1); expect(review.evidence.delayed_tasks[0].id).toBe(b.id);
  });
  it('due day is inclusive for unfinished tasks and null/future dates never count as delayed', async () => {
    const task = await makeTask(); await makeTask({ due_date: null }); await makeTask({ due_date: '2026-10-04' });
    clock = '2026-10-02T14:59:59.999Z'; expect((await diary.review()).delayed_count).toBe(0);
    clock = '2026-10-02T15:00:00.000Z'; const review = await diary.review();
    expect(review.delayed_count).toBe(1); expect(review.evidence.delayed_tasks[0].id).toBe(task.id);
  });
  it('reopening changes completion counts without losing actual time and uses current overdue rule', async () => {
    const task = await makeTask(); await complete(task.id, 60); await diary.reopen(task.id); clock = '2026-10-03T03:00:00.000Z';
    expect(await diary.review()).toMatchObject({ completed_count: 0, delayed_count: 1, actual_seconds: 60, task_estimated_seconds: 600 });
  });
});

describe('copy and full JSON export', () => {
  it('creates new plan/task IDs, copies required attributes/tags, sets new deadline and source link, and copies no logs', async () => {
    const source = await makeTask(); const original = await complete(source.id, 30);
    const beforeTask = await diary.task(source.id); const beforePlan = await diary.plan(source.plan_id);
    const copied = await diary.copyCompleted(source.plan_id, { plan: { ...planInput, title: '다음 계획 테스트' }, tasks: [{ task_id: source.id, due_date: '2026-10-08' }] });
    expect(copied.plan.id).not.toBe(source.plan_id); expect(copied.plan.current_version).toBe(1);
    const next = copied.tasks[0]; expect(next.id).not.toBe(source.id);
    expect(next).toMatchObject({ plan_id: copied.plan.id, copied_from_task_id: source.id, content: source.content, priority: source.priority, estimated_seconds: source.estimated_seconds, status: 'in_progress', completed_at: null, due_date: '2026-10-08' });
    expect(next.tags).toEqual(source.tags); expect(await diary.executions(next.id)).toEqual([]);
    expect(await diary.executions(source.id)).toEqual([original]); expect(await diary.task(source.id)).toEqual(beforeTask); expect(await diary.plan(source.plan_id)).toEqual(beforePlan);
  });
  it('rejects non-completed/deleted/wrong-plan copy sources without leaving a partial new plan', async () => {
    const source = await makeTask(); const other = await diary.createPlan(planInput);
    const copy = (planId: string) => diary.copyCompleted(planId, { plan: planInput, tasks: [{ task_id: source.id, due_date: null }] });
    await expect(copy(source.plan_id)).rejects.toMatchObject({ status: 409 }); await complete(source.id);
    await expect(copy(other.id)).rejects.toMatchObject({ status: 409 }); await diary.deleteTask(source.id);
    await expect(copy(source.plan_id)).rejects.toMatchObject({ status: 404 }); expect(await diary.plans()).toHaveLength(2);
  });
  it('copy is atomic if a source is reopened between validation and the write transaction', async () => {
    const source = await makeTask(); await complete(source.id);
    const wrapped: Database = {
      all: (sql, params) => db.all(sql, params),
      batch: async (statements: Statement[]) => {
        db.sqlite.prepare("UPDATE tasks SET status = 'in_progress', completed_at = NULL WHERE id = ?").run(source.id);
        return db.batch(statements);
      },
    };
    await expect(new Diary(wrapped, fixture.userId, () => clock).copyCompleted(source.plan_id, { plan: planInput, tasks: [{ task_id: source.id, due_date: null }] })).rejects.toThrow('copy source');
    expect(await diary.plans()).toHaveLength(1); expect(await db.all('SELECT * FROM tasks')).toHaveLength(1);
  });
  it('one JSON contains every table/version/archived row/log, validates against schema, and round-trips without loss', async () => {
    const source = await makeTask(); await complete(source.id, 30); await diary.reopen(source.id); await complete(source.id, 20);
    await diary.updatePlan(source.plan_id, { ...planInput, title: '수정된 테스트 계획' }, 1);
    const copied = await diary.copyCompleted(source.plan_id, { plan: planInput, tasks: [{ task_id: source.id, due_date: null }] });
    await diary.start(copied.tasks[0].id, id()); await diary.deleteTask(source.id);
    const exported = await diary.exportAll(); const parsed: DatabaseExport = JSON.parse(JSON.stringify(exported)); expect(parsed).toEqual(exported);
    expect(parsed.plan_versions).toHaveLength(3); expect(parsed.tasks).toHaveLength(2); expect(parsed.execution_logs).toHaveLength(3);
    const names = ['plans', 'plan_versions', 'tasks', 'tags', 'task_tags', 'execution_logs'] as const;
    for (const name of names) {
      expect(parsed.export_metadata.table_counts[name]).toBe(parsed[name].length);
      const rows = await db.all(`SELECT * FROM ${name}`);
      expect(parsed[name]).toEqual(expect.arrayContaining(rows)); expect(parsed[name].length).toBe(rows.length);
    }
    const ajv = new Ajv2020({ strict: false }); addFormats(ajv);
    const validate = ajv.compile(JSON.parse(readFileSync(new URL('../contracts/pds-schema-v3.json', import.meta.url), 'utf8')));
    expect(validate(parsed), JSON.stringify(validate.errors)).toBe(true);
    const planIds = new Set(parsed.plans.map(p => p.id)); const taskIds = new Set(parsed.tasks.map(t => t.id)); const tagIds = new Set(parsed.tags.map(t => t.id));
    expect(parsed.plan_versions.every(v => planIds.has(v.plan_id))).toBe(true);
    expect(parsed.plans.every(p => parsed.plan_versions.some(v => v.plan_id === p.id && v.version === p.current_version))).toBe(true);
    expect(parsed.tasks.every(t => planIds.has(t.plan_id) && (!t.copied_from_task_id || taskIds.has(t.copied_from_task_id)))).toBe(true);
    expect(parsed.task_tags.every(t => taskIds.has(t.task_id) && tagIds.has(t.tag_id))).toBe(true);
    expect(parsed.execution_logs.every(e => taskIds.has(e.task_id))).toBe(true);
    expect(Object.keys(parsed).sort()).toEqual([...names, 'schema_version', 'exported_at', 'timezone', 'export_metadata'].sort());
    expect(parsed.execution_logs.find(log => log.ended_at === null)?.actual_seconds).toBeNull();
    expect(JSON.stringify(parsed)).not.toMatch(/password|api_key|authentication|_migrations|process\.env|cloudflare.*token/i);
  });
  it('API supports start/finish/reopen/review/copy/export with input validation and download headers', async () => {
    const task = await makeTask(); const app = fixture.authenticatedApp(db);
    const post = (path: string, body: unknown) => app.request(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post(`/tasks/${task.id}/start`, { request_id: 'bad' })).status).toBe(400);
    const started = await (await post(`/tasks/${task.id}/start`, { request_id: id() })).json() as ExecutionLog;
    const responses = await Promise.all(Array.from({ length: 10 }, () => post(`/tasks/${task.id}/executions/${started.id}/finish`, { request_id: id() })));
    expect(responses.every(r => r.status === 200)).toBe(true); expect(await db.all('SELECT * FROM execution_logs')).toHaveLength(1);
    const review = await app.request(`/api/review?plan_id=${task.plan_id}`); expect(review.status).toBe(200);
    expect((await post(`/plans/${task.plan_id}/copy-completed`, { plan: planInput, tasks: [{ task_id: task.id, due_date: '2026-10-09' }] })).status).toBe(201);
    expect((await post(`/tasks/${task.id}/reopen`, {})).status).toBe(200);
    expect((await post(`/tasks/${task.id}/reopen`, { password: 'no' })).status).toBe(400);
    const response = await app.request('/api/export'); expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="t07-diary.json"'); expect(response.headers.get('content-type')).toContain('application/json');
    expect((await response.json() as DatabaseExport).plans).toHaveLength(2);
  });
  it('duplicate copy selections and invalid due dates are rejected by the API', async () => {
    const source = await makeTask(); await complete(source.id); const app = fixture.authenticatedApp(db);
    for (const tasks of [[{ task_id: source.id, due_date: null }, { task_id: source.id, due_date: null }], [{ task_id: source.id, due_date: '2026-02-30' }]]) {
      const response = await app.request(`/api/plans/${source.plan_id}/copy-completed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: planInput, tasks }) });
      expect(response.status).toBe(400);
    }
    expect(await diary.plans()).toHaveLength(1);
  });
  it('ownerless phase-1 upgrade fails closed and retains plans, versions and tasks', () => {
    const path = join(directory, 'old.sqlite'); const old = new DatabaseSync(path);
    old.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
    old.exec('CREATE TABLE _migrations (name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)');
    old.prepare('INSERT INTO _migrations VALUES (?, ?)').run('0001_initial.sql', clock);
    old.prepare('INSERT INTO plans VALUES (?, ?, ?, ?)').run('old-plan', 1, clock, clock);
    old.prepare('INSERT INTO plan_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('old-plan', 1, '이전 계획', '2026-10-01', '2026-10-09', '보존', 600, clock);
    old.prepare('INSERT INTO tasks (id, plan_id, content, priority, estimated_seconds, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('old-task', 'old-plan', '이전 할 일', 'low', 300, clock, clock); old.close();
    expect(() => new LocalDatabase(path)).toThrow('CHECK constraint');
    const preserved = new DatabaseSync(path);
    try {
      expect(preserved.prepare('SELECT title FROM plan_versions').get()?.title).toBe('이전 계획');
      expect(preserved.prepare('SELECT content FROM tasks').get()?.content).toBe('이전 할 일');
      expect(preserved.prepare("SELECT name FROM _migrations WHERE name='0004_ownership.sql'").get()).toBeUndefined();
    } finally { preserved.close(); }
  });
});
