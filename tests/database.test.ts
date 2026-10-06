import { account } from './fixtures.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDatabase } from '../src/server/local-db.ts';
import { createApp } from '../src/server/app.ts';
import { Diary } from '../src/server/services.ts';
import type { Plan, Task, PlanVersion, TaskInput } from '../src/shared/types.ts';

export const planInput = { title: '테스트 전용 계획', period_start: '2026-10-02', period_end: '2026-10-09', success_criteria: '테스트에서만 사용하는 기준', estimated_seconds: 3600 };
const taskInput: TaskInput = { content: '테스트 전용 할 일', priority: 'medium', due_date: '2026-10-03', estimated_seconds: 600, tags: ['학습', '테스트'] };
let fixture: Awaited<ReturnType<typeof account>>; let db: LocalDatabase;
let app: ReturnType<typeof createApp>;
let directory: string;

async function request(path: string, method = 'GET', body?: unknown) {
  return app.request(`/api${path}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function createPlan() {
  const response = await request('/plans', 'POST', planInput);
  expect(response.status).toBe(201);
  return await response.json() as Plan;
}
async function createTask(planId: string, input: TaskInput = taskInput) {
  const response = await request(`/plans/${planId}/tasks`, 'POST', input);
  expect(response.status).toBe(201);
  return await response.json() as Task;
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 't06-unit-'));
  db = new LocalDatabase(join(directory, 'test.sqlite')); fixture = await account(db);
  app = fixture.authenticatedApp(db);
});
afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

describe('T06 phase 1: actual SQLite and API', () => {
  it('starts with an empty DB and exposes no fixture as real data', async () => {
    expect(await (await request('/plans')).json()).toEqual([]);
    expect(await db.all('SELECT * FROM execution_logs')).toEqual([]);
  });
  it('creates a plan with server ID and initial version containing every input field', async () => {
    const plan = await createPlan();
    expect(plan.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(plan.current_version).toBe(1);
    expect(plan).toMatchObject(planInput);
    expect((await request(`/plans/${plan.id}`)).status).toBe(200);
    expect(await db.all('SELECT * FROM plans')).toHaveLength(1);
    expect(await db.all('SELECT * FROM plan_versions')).toHaveLength(1);
  });
  it('preserves original and intermediate versions and keeps the plan ID on two edits', async () => {
    const original = await createPlan();
    const changed = { ...planInput, title: '수정된 제목', success_criteria: '수정된 기준', estimated_seconds: 4800 };
    const second = await (await request(`/plans/${original.id}`, 'PUT', { ...changed, expected_version: 1 })).json() as Plan;
    const third = await (await request(`/plans/${original.id}`, 'PUT', { ...changed, title: '세 번째', expected_version: 2 })).json() as Plan;
    expect(second.id).toBe(original.id); expect(third.id).toBe(original.id); expect(third.current_version).toBe(3);
    const history = await (await request(`/plans/${original.id}/versions`)).json() as PlanVersion[];
    expect(history.map(v => v.version)).toEqual([3, 2, 1]);
    expect(history[2]).toMatchObject(planInput);
    expect(history[1]).toMatchObject(changed);
    expect(await db.all('SELECT * FROM plans')).toHaveLength(1);
  });
  it('DB itself prevents update and delete of preserved versions', async () => {
    const plan = await createPlan();
    expect(() => db.sqlite.prepare('UPDATE plan_versions SET title = ? WHERE plan_id = ?').run('덮어쓰기', plan.id)).toThrow('immutable');
    expect(() => db.sqlite.prepare('DELETE FROM plan_versions WHERE plan_id = ?').run(plan.id)).toThrow('immutable');
    expect((await new Diary(db, fixture.userId).history(plan.id))[0].title).toBe(planInput.title);
  });
  it('rejects a stale plan edit without creating another version', async () => {
    const plan = await createPlan();
    expect((await request(`/plans/${plan.id}`, 'PUT', { ...planInput, title: '먼저 저장', expected_version: 1 })).status).toBe(200);
    expect((await request(`/plans/${plan.id}`, 'PUT', { ...planInput, title: '오래된 화면', expected_version: 1 })).status).toBe(409);
    expect(await db.all('SELECT * FROM plan_versions')).toHaveLength(2);
    expect((await new Diary(db, fixture.userId).plan(plan.id)).title).toBe('먼저 저장');
  });
  it('rolls back the complete batch when creating a version fails', async () => {
    await expect(db.batch([
      { sql: 'INSERT INTO plans (id, owner_user_id, current_version, created_at, updated_at) VALUES (?, ?, 1, ?, ?)', params: ['rollback', fixture.userId, '2026-10-02T00:00:00.000Z', '2026-10-02T00:00:00.000Z'] },
      { sql: 'INSERT INTO plan_versions (plan_id, version, title, period_start, period_end, success_criteria, estimated_seconds, recorded_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?)', params: ['rollback', '', '2026-10-02', '2026-10-03', '기준', 60, '2026-10-02T00:00:00.000Z'] },
    ])).rejects.toThrow();
    expect(await db.all('SELECT * FROM plans')).toHaveLength(0);
  });
  it('stores at least five tasks, all attributes, and normalized tag relationships', async () => {
    const plan = await createPlan();
    for (let i = 0; i < 5; i++) await createTask(plan.id, { ...taskInput, content: `테스트 ${i}`, tags: ['학습', ' 학습 ', '테스트'] });
    const tasks = await (await request(`/plans/${plan.id}/tasks`)).json() as Task[];
    expect(tasks).toHaveLength(5);
    expect(tasks.every(t => t.priority === 'medium' && t.due_date === taskInput.due_date && t.estimated_seconds === 600 && t.plan_id === plan.id)).toBe(true);
    expect(await db.all('SELECT * FROM tags')).toHaveLength(2);
    expect(await db.all('SELECT * FROM task_tags')).toHaveLength(10);
  });
  it('edits task attributes and replaces tag relations without changing task or plan ID', async () => {
    const plan = await createPlan(); const original = await createTask(plan.id);
    const changed = { content: '바뀐 할 일', priority: 'high', due_date: null, estimated_seconds: 1200, tags: ['새 태그'] };
    const response = await request(`/tasks/${original.id}`, 'PUT', changed);
    expect(response.status).toBe(200);
    const task = await response.json() as Task;
    expect(task.id).toBe(original.id); expect(task.plan_id).toBe(plan.id);
    expect(task).toMatchObject({ ...changed, tags: [{ name: '새 태그' }] });
    expect(await db.all('SELECT * FROM task_tags')).toHaveLength(1);
  });
  it('removes a task from the list but preserves its DB row and tag relationships', async () => {
    const plan = await createPlan(); const task = await createTask(plan.id);
    expect((await request(`/tasks/${task.id}`, 'DELETE')).status).toBe(204);
    expect((await request(`/tasks/${task.id}`)).status).toBe(404);
    expect(await (await request(`/plans/${plan.id}/tasks`)).json()).toEqual([]);
    const [row] = await db.all<{ deleted_at: string }>('SELECT deleted_at FROM tasks WHERE id = ?', [task.id]);
    expect(row.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await db.all('SELECT * FROM task_tags')).toHaveLength(2);
    expect((await request(`/tasks/${task.id}`, 'PUT', taskInput)).status).toBe(404);
  });
  it('separates tasks by plan and refuses tasks with a missing parent plan', async () => {
    const a = await createPlan(); const b = await createPlan(); await createTask(a.id);
    expect(await (await request(`/plans/${b.id}/tasks`)).json()).toEqual([]);
    expect((await request('/plans/missing/tasks', 'POST', taskInput)).status).toBe(404);
    expect(() => db.sqlite.prepare('INSERT INTO tasks (id, plan_id, content, priority, estimated_seconds, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('bad', 'missing', '할 일', 'low', 60, 'now', 'now')).toThrow();
  });
  it('reads identical data after fresh app initialization and DB close/reopen', async () => {
    const plan = await createPlan(); const task = await createTask(plan.id);
    app = fixture.authenticatedApp(db);
    expect(await (await request(`/tasks/${task.id}`)).json()).toEqual(task);
    db.close(); db = new LocalDatabase(join(directory, 'test.sqlite')); app = fixture.authenticatedApp(db);
    expect(await (await request(`/plans/${plan.id}`)).json()).toEqual(plan);
    expect(await (await request(`/tasks/${task.id}`)).json()).toEqual(task);
    expect((await db.all<{name:string}>('SELECT name FROM _migrations')).map(r=>r.name)).toContain('0004_ownership.sql');
  });
  it('searches literal text, filters tags/priority/due dates, and combines criteria', async () => {
    const plan = await createPlan();
    const a = await createTask(plan.id, { ...taskInput, content: '읽기 100%_책', priority: 'high', due_date: '2026-10-04', tags: ['독서'] });
    await createTask(plan.id, { ...taskInput, content: '읽기 다른 책', priority: 'low', due_date: '2026-10-06', tags: ['독서'] });
    await createTask(plan.id, { ...taskInput, content: '운동', priority: 'high', due_date: null, tags: ['건강'] });
    const ids = async (query: string) => ((await (await request(`/plans/${plan.id}/tasks?${query}`)).json()) as Task[]).map(t => t.id);
    expect(await ids('search=' + encodeURIComponent('100%_'))).toEqual([a.id]);
    expect(await ids('tag=' + encodeURIComponent('독서'))).toHaveLength(2);
    expect(await ids('priority=high')).toHaveLength(2);
    expect(await ids('due_from=2026-10-03&due_to=2026-10-04')).toEqual([a.id]);
    expect(await ids('search=' + encodeURIComponent('읽기') + '&tag=' + encodeURIComponent('독서') + '&priority=high&due_to=2026-10-05')).toEqual([a.id]);
  });
  it('sorts due dates (null last), priority, estimates, and creation time deterministically', async () => {
    const plan = await createPlan();
    let tick = 0;
    const diary = new Diary(db, fixture.userId, () => new Date(Date.UTC(2026, 9, 2, 0, 0, tick++)).toISOString());
    const a = await diary.createTask(plan.id, { ...taskInput, content: 'a', priority: 'low', due_date: null, estimated_seconds: 300 });
    const b = await diary.createTask(plan.id, { ...taskInput, content: 'b', priority: 'high', due_date: '2026-10-05', estimated_seconds: 100 });
    const c = await diary.createTask(plan.id, { ...taskInput, content: 'c', priority: 'medium', due_date: '2026-10-03', estimated_seconds: 200 });
    const ids = async (sort: string) => ((await (await request(`/plans/${plan.id}/tasks?sort=${sort}`)).json()) as Task[]).map(t => t.id);
    expect(await ids('due_asc')).toEqual([c.id, b.id, a.id]);
    expect(await ids('priority')).toEqual([b.id, c.id, a.id]);
    expect(await ids('estimated_asc')).toEqual([b.id, c.id, a.id]);
    expect(await ids('created_asc')).toEqual([a.id, b.id, c.id]);
    expect(await ids('created_desc')).toEqual([c.id, b.id, a.id]);
  });
  it('rejects invalid dates, reversed periods, negative estimates and unknown secret fields', async () => {
    for (const invalid of [
      { ...planInput, title: '  ' }, { ...planInput, period_start: '2026-02-30' },
      { ...planInput, period_end: '2026-10-01' }, { ...planInput, estimated_seconds: -1 },
      { ...planInput, estimated_seconds: 1.5 }, { ...planInput, api_key: 'not-stored' },
    ]) expect((await request('/plans', 'POST', invalid)).status).toBe(400);
    expect(await db.all('SELECT * FROM plans')).toEqual([]);
    const plan = await createPlan();
    for (const invalid of [{ ...taskInput, priority: 'urgent' }, { ...taskInput, due_date: '2026-02-30' }, { ...taskInput, tags: [''] }, { ...taskInput, status: 'completed' }, { ...taskInput, password: 'not-stored' }]) {
      expect((await request(`/plans/${plan.id}/tasks`, 'POST', invalid)).status).toBe(400);
    }
    expect((await request(`/plans/${plan.id}/tasks?sort=DROP%20TABLE%20tasks`)).status).toBe(400);
    expect((await request(`/plans/${plan.id}/tasks?due_from=2026-10-09&due_to=2026-10-02`)).status).toBe(400);
  });
  it('uses binding for SQL-like content and returns script-like strings as JSON text', async () => {
    const payload = "<script>globalThis.__t06Xss = true</script>'; DROP TABLE plans; --";
    const plan = await (await request('/plans', 'POST', { ...planInput, title: payload, success_criteria: payload })).json() as Plan;
    const task = await createTask(plan.id, { ...taskInput, content: payload, tags: ["'; DROP TABLE tasks; --"] });
    expect(task.content).toBe(payload); expect(plan.title).toBe(payload);
    expect((await request(`/plans/${plan.id}/tasks?search=${encodeURIComponent(payload)}`)).status).toBe(200);
    expect(await db.all('SELECT * FROM plans')).toHaveLength(1);
    expect(await db.all('SELECT * FROM tasks')).toHaveLength(1);
    const response = await request(`/tasks/${task.id}`);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
  it('requires authentication and rejects unrelated browser-origin writes', async () => {
    expect((await createApp(db, fixture.auth).request('/api/plans')).status).toBe(401); expect((await request('/health')).status).toBe(200); await createPlan();
    const response = await app.request('/api/plans', { method: 'POST', headers: { Origin: 'https://other.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify(planInput) });
    expect(response.status).toBe(403);
    expect((await app.request('/api/plans', { method: 'POST', body: '{}' })).status).toBe(415);
  });
  it('returns useful errors for malformed JSON, oversized requests, and missing records', async () => {
    expect((await app.request('/api/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status).toBe(400);
    expect((await app.request('/api/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x'.repeat(70000) }) })).status).toBe(413);
    expect((await request('/plans/missing')).status).toBe(404);
    expect((await request('/plans/missing/versions')).status).toBe(404);
    expect((await request('/tasks/missing', 'DELETE')).status).toBe(404);
  });
});
