import type { Database, Parameter, Statement } from './db.ts';
import type { Plan, PlanInput, PlanVersion, Task, TaskInput, Tag, ExecutionLog, CopyInput, Review, DatabaseExport, ExportTables } from '../shared/types.ts';
import type { z } from 'zod';
import type { taskQuerySchema } from '../shared/validation.ts';

export class AppError extends Error {
  constructor(readonly status: 404 | 409 | 400, message: string) { super(message); }
}
const statement = (sql: string, params: Parameter[] = []): Statement => ({ sql, params });
const planSelect = `SELECT p.*, v.* FROM plans p JOIN plan_versions v ON v.plan_id = p.id AND v.version = p.current_version`;

export class Diary {
  constructor(readonly db: Database, readonly userId: string, private readonly now = () => new Date().toISOString()) {
    if (typeof userId !== 'string' || !userId.trim()) throw new Error('Authenticated user ID required');
  }
  private get taskScope() { return "plan_id IN (SELECT id FROM plans WHERE owner_user_id = ?)"; }
  private get logScope() { return "task_id IN (SELECT id FROM tasks WHERE " + this.taskScope + ")"; }
  async plans(): Promise<Plan[]> {
    return this.db.all<Plan>(`${planSelect} WHERE p.owner_user_id = ? ORDER BY p.created_at DESC, p.id ASC`, [this.userId]);
  }
  async plan(id: string): Promise<Plan> {
    const [plan] = await this.db.all<Plan>(`${planSelect} WHERE p.id = ? AND p.owner_user_id = ?`, [id, this.userId]);
    if (!plan) throw new AppError(404, '계획을 찾을 수 없습니다.');
    return plan;
  }
  async createPlan(input: PlanInput): Promise<Plan> {
    const id = crypto.randomUUID();
    const timestamp = this.now();
    await this.db.batch([
      statement('INSERT INTO plans (id, current_version, created_at, updated_at, owner_user_id) VALUES (?, 1, ?, ?, ?)', [id, timestamp, timestamp, this.userId]),
      statement(`INSERT INTO plan_versions (plan_id, version, title, period_start, period_end, success_criteria, estimated_seconds, recorded_at)
        VALUES (?, 1, ?, ?, ?, ?, ?, ?)`, [id, input.title, input.period_start, input.period_end, input.success_criteria, input.estimated_seconds, timestamp]),
    ]);
    return this.plan(id);
  }
  async updatePlan(id: string, input: PlanInput, expected: number): Promise<Plan> {
    await this.plan(id);
    const timestamp = this.now();
    // Conditional INSERT and UPDATE are in the same transaction, so stale requests never overwrite history.
    const result = await this.db.batch([
      statement(`INSERT INTO plan_versions (plan_id, version, title, period_start, period_end, success_criteria, estimated_seconds, recorded_at)
        SELECT id, current_version + 1, ?, ?, ?, ?, ?, ? FROM plans WHERE id = ? AND current_version = ? AND owner_user_id = ?`,
        [input.title, input.period_start, input.period_end, input.success_criteria, input.estimated_seconds, timestamp, id, expected, this.userId]),
      statement('UPDATE plans SET current_version = current_version + 1, updated_at = ? WHERE id = ? AND current_version = ? AND owner_user_id = ?', [timestamp, id, expected, this.userId]),
    ]);
    if (result[0].changes !== 1) throw new AppError(409, '계획이 이미 수정되었습니다. 최신 내용을 불러온 뒤 다시 수정하세요.');
    return this.plan(id);
  }
  async history(id: string): Promise<PlanVersion[]> {
    await this.plan(id);
    return this.db.all<PlanVersion>('SELECT * FROM plan_versions WHERE plan_id = ? AND plan_id IN (SELECT id FROM plans WHERE owner_user_id = ?) ORDER BY version DESC', [id, this.userId]);
  }
  private async withTags(rows: Omit<Task, 'tags'>[]): Promise<Task[]> {
    if (!rows.length) return [];
    const ids = rows.map(t => t.id);
    const related = await this.db.all<Tag & { task_id: string }>(
      `SELECT tt.task_id, tags.id, tags.name FROM task_tags tt JOIN tags ON tags.id = tt.tag_id
       WHERE tags.owner_user_id = ? AND tt.task_id IN (${ids.map(() => '?').join(',')}) AND tt.task_id IN (SELECT id FROM tasks WHERE ${this.taskScope}) ORDER BY tags.name, tags.id`, [this.userId, ...ids, this.userId]);
    const byTask = new Map<string, Tag[]>();
    for (const tag of related) {
      const list = byTask.get(tag.task_id) ?? [];
      list.push({ id: tag.id, name: tag.name });
      byTask.set(tag.task_id, list);
    }
    return rows.map(row => ({ ...row, tags: byTask.get(row.id) ?? [] }));
  }
  async task(id: string): Promise<Task> {
    const rows = await this.db.all<Omit<Task, 'tags'>>(`SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL AND ${this.taskScope}`, [id, this.userId]);
    if (!rows.length) throw new AppError(404, '할 일을 찾을 수 없습니다.');
    return (await this.withTags(rows))[0];
  }
  async tasks(planId: string, query: z.infer<typeof taskQuerySchema>): Promise<Task[]> {
    await this.plan(planId);
    const where = ['t.plan_id = ?', 't.deleted_at IS NULL', 't.' + this.taskScope];
    const params: Parameter[] = [planId, this.userId];
    if (query.search) {
      // instr performs literal substring search, so %, _ and SQL-like input stay literal.
      where.push('instr(lower(t.content), lower(?)) > 0'); params.push(query.search);
    }
    if (query.priority) { where.push('t.priority = ?'); params.push(query.priority); }
    if (query.tag) {
      where.push('EXISTS (SELECT 1 FROM task_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.task_id = t.id AND g.name = ? AND g.owner_user_id = p.owner_user_id)'); params.push(query.tag);
    }
    if (query.due_from) { where.push('t.due_date >= ?'); params.push(query.due_from); }
    if (query.due_to) { where.push('t.due_date <= ?'); params.push(query.due_to); }
    const orders = {
      created_desc: 't.created_at DESC, t.id ASC',
      created_asc: 't.created_at ASC, t.id ASC',
      due_asc: 't.due_date IS NULL, t.due_date ASC, t.id ASC',
      priority: "CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, t.id ASC",
      estimated_asc: 't.estimated_seconds ASC, t.id ASC',
    };
    return this.withTags(await this.db.all<Omit<Task, 'tags'>>(
      `SELECT t.* FROM tasks t JOIN plans p ON p.id=t.plan_id WHERE ${where.join(' AND ')} ORDER BY ${orders[query.sort]}`, params));
  }
  private tagStatements(taskId: string, names: string[]): Statement[] {
    return names.flatMap(name => [
      statement(`INSERT INTO tags (id, name, owner_user_id) SELECT ?, ?, ? WHERE EXISTS(SELECT 1 FROM tasks WHERE id = ? AND ${this.taskScope}) ON CONFLICT(owner_user_id, name) DO NOTHING`, [crypto.randomUUID(), name, this.userId, taskId, this.userId]),
      statement(`INSERT INTO task_tags (task_id, tag_id) SELECT ?, id FROM tags WHERE name = ? AND owner_user_id = ? AND EXISTS(SELECT 1 FROM tasks WHERE id = ? AND ${this.taskScope})`, [taskId, name, this.userId, taskId, this.userId]),
    ]);
  }
  async createTask(planId: string, input: TaskInput): Promise<Task> {
    await this.plan(planId);
    const id = crypto.randomUUID();
    const timestamp = this.now();
    await this.db.batch([
      statement(`INSERT INTO tasks (id, plan_id, content, priority, due_date, estimated_seconds, created_at, updated_at)
        SELECT ?, id, ?, ?, ?, ?, ?, ? FROM plans WHERE id = ? AND owner_user_id = ?`, [id, input.content, input.priority, input.due_date, input.estimated_seconds, timestamp, timestamp, planId, this.userId]),
      ...this.tagStatements(id, input.tags),
    ]);
    return this.task(id);
  }
  async updateTask(id: string, input: TaskInput): Promise<Task> {
    await this.task(id);
    await this.db.batch([
      statement(`UPDATE tasks SET content = ?, priority = ?, due_date = ?, estimated_seconds = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL AND ${this.taskScope}`, [input.content, input.priority, input.due_date, input.estimated_seconds, this.now(), id, this.userId]),
      statement(`DELETE FROM task_tags WHERE task_id = ? AND task_id IN(SELECT id FROM tasks WHERE ${this.taskScope})`, [id, this.userId]),
      ...this.tagStatements(id, input.tags),
    ]);
    return this.task(id);
  }
  async deleteTask(id: string): Promise<void> {
    await this.task(id);
    if ((await this.db.all(`SELECT id FROM execution_logs WHERE task_id = ? AND ended_at IS NULL AND ${this.logScope}`, [id, this.userId])).length) {
      throw new AppError(409, '실행 중인 할 일은 먼저 완료한 뒤 삭제하세요.');
    }
    const timestamp = this.now();
    // Preserve relationships and future execution evidence; hide the task from the active list.
    await this.db.batch([statement(`UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL AND ${this.taskScope}`, [timestamp, timestamp, id, this.userId])]);
  }

  async executions(taskId: string): Promise<ExecutionLog[]> {
    await this.task(taskId);
    return this.db.all<ExecutionLog>(`SELECT * FROM execution_logs WHERE task_id = ? AND ${this.logScope} ORDER BY started_at, id`, [taskId, this.userId]);
  }
  async planExecutions(planId: string): Promise<ExecutionLog[]> {
    await this.plan(planId);
    return this.db.all<ExecutionLog>('SELECT e.* FROM execution_logs e JOIN tasks t ON t.id = e.task_id WHERE t.plan_id = ? AND t.plan_id IN(SELECT id FROM plans WHERE owner_user_id = ?) ORDER BY e.started_at, e.id', [planId, this.userId]);
  }
  async start(taskId: string, requestId: string): Promise<ExecutionLog> {
    await this.task(taskId);
    const [used] = await this.db.all<ExecutionLog>(`SELECT * FROM execution_logs WHERE start_request_id = ? AND ${this.logScope}`, [requestId, this.userId]);
    if (used) {
      if (used.task_id !== taskId) throw new AppError(409, '이 시작 요청 ID는 다른 할 일에 사용되었습니다.');
      return used;
    }
    const result = await this.db.batch([
      statement(`INSERT INTO execution_logs (id, task_id, started_at, estimated_seconds_at_start, start_request_id)
        SELECT ?, id, ?, estimated_seconds, ? FROM tasks
        WHERE id = ? AND deleted_at IS NULL AND status = 'in_progress' AND ${this.taskScope}
          AND NOT EXISTS (SELECT 1 FROM execution_logs WHERE task_id = ? AND ended_at IS NULL)
        ON CONFLICT DO NOTHING`, [crypto.randomUUID(), this.now(), requestId, taskId, this.userId, taskId]),
      statement(`SELECT * FROM execution_logs WHERE (start_request_id = ? OR (task_id = ? AND ended_at IS NULL)) AND ${this.logScope}
        ORDER BY CASE WHEN start_request_id = ? THEN 0 ELSE 1 END LIMIT 1`, [requestId, taskId, this.userId, requestId]),
    ]);
    const log = result[1].results[0] as unknown as ExecutionLog | undefined;
    if (!log) throw new AppError(409, '완료한 할 일은 진행 중으로 되돌린 후 시작하세요.');
    if (log.task_id !== taskId) throw new AppError(409, '이 시작 요청 ID는 다른 할 일에 사용되었습니다.');
    return log;
  }
  async finish(taskId: string, logId: string, requestId: string): Promise<ExecutionLog> {
    await this.task(taskId);
    const [log] = await this.db.all<ExecutionLog>(`SELECT * FROM execution_logs WHERE id = ? AND task_id = ? AND ${this.logScope}`, [logId, taskId, this.userId]);
    if (!log) throw new AppError(404, '해당 할 일의 실행 기록을 찾을 수 없습니다.');
    const [used] = await this.db.all<ExecutionLog>(`SELECT * FROM execution_logs WHERE finish_request_id = ? AND ${this.logScope}`, [requestId, this.userId]);
    if (used && used.id !== logId) throw new AppError(409, '이 완료 요청 ID는 다른 실행에 사용되었습니다.');
    // A stale finish request always refers to its original log, never to a later execution.
    if (log.ended_at !== null) return log;
    const ended = this.now();
    const elapsed = Date.parse(ended) - Date.parse(log.started_at);
    if (!Number.isFinite(elapsed) || elapsed < 0) throw new AppError(409, '서버 시간이 시작 시각보다 빠릅니다. 잠시 후 다시 완료하세요.');
    const result = await this.db.batch([
      statement(`UPDATE execution_logs SET ended_at = ?, actual_seconds = ?, finish_request_id = ?
        WHERE id = ? AND task_id = ? AND ended_at IS NULL AND ${this.logScope}
          AND NOT EXISTS (SELECT 1 FROM execution_logs WHERE finish_request_id = ? AND id <> ?)`,
        [ended, Math.floor(elapsed / 1000), requestId, logId, taskId, this.userId, requestId, logId]),
      statement(`SELECT * FROM execution_logs WHERE id = ? AND task_id = ? AND ${this.logScope}`, [logId, taskId, this.userId]),
    ]);
    const closed = result[1].results[0] as unknown as ExecutionLog;
    if (closed.ended_at === null) throw new AppError(409, '이 완료 요청 ID는 다른 실행에 사용되었습니다.');
    return closed;
  }
  async reopen(taskId: string): Promise<Task> {
    await this.task(taskId);
    await this.db.batch([statement(`UPDATE tasks SET status = 'in_progress', completed_at = NULL, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL AND status = 'completed' AND ${this.taskScope}`, [this.now(), taskId, this.userId])]);
    return this.task(taskId);
  }
  async review(planId?: string): Promise<Review> {
    if (planId) await this.plan(planId);
    const asOf = this.now();
    const today = koreanDate(asOf);
    const params: Parameter[] = planId ? [this.userId, planId] : [this.userId];
    // All evidence is read in one transaction; numbers are calculated from that exact snapshot.
    const snapshot = await this.db.batch([
      statement(`${planSelect} WHERE p.owner_user_id = ? ${planId ? ' AND p.id = ?' : ''} ORDER BY p.id`, params),
      statement(`SELECT * FROM tasks WHERE ${this.taskScope}${planId ? ' AND plan_id = ?' : ''} ORDER BY id`, params),
      statement(`SELECT e.* FROM execution_logs e JOIN tasks t ON t.id = e.task_id WHERE t.${this.taskScope}${planId ? ' AND t.plan_id = ?' : ''} ORDER BY e.started_at, e.id`, params),
      statement(`SELECT tt.task_id, g.id, g.name FROM task_tags tt JOIN tags g ON g.id = tt.tag_id JOIN tasks t ON t.id=tt.task_id WHERE t.${this.taskScope} AND g.owner_user_id = ? ${planId ? 'AND t.plan_id = ?' : ''} ORDER BY g.name, g.id`, planId ? [this.userId,this.userId,planId] : [this.userId,this.userId]),
    ]);
    const plans = snapshot[0].results as unknown as Plan[];
    const tags = snapshot[3].results as unknown as (Tag & { task_id: string })[];
    const byTask = new Map<string, Tag[]>();
    for (const tag of tags) { const list = byTask.get(tag.task_id) ?? []; list.push({ id: tag.id, name: tag.name }); byTask.set(tag.task_id, list); }
    const tasks = (snapshot[1].results as unknown as Omit<Task, 'tags'>[]).map(t => ({ ...t, tags: byTask.get(t.id) ?? [] }));
    const executions = snapshot[2].results as unknown as ExecutionLog[];
    const completed = tasks.filter(t => t.status === 'completed');
    const delayed = tasks.filter(t => t.due_date !== null && (t.status === 'completed'
      ? t.completed_at !== null && koreanDate(t.completed_at) > t.due_date
      : today > t.due_date));
    const closed = executions.filter(e => e.ended_at !== null);
    const taskEstimated = tasks.reduce((sum, t) => sum + t.estimated_seconds, 0);
    const actual = closed.reduce((sum, e) => sum + (e.actual_seconds ?? 0), 0);
    return {
      as_of: asOf, today, timezone: 'Asia/Seoul', plan_count: plans.length,
      completed_count: completed.length, delayed_count: delayed.length,
      plan_estimated_seconds: plans.reduce((sum, p) => sum + p.estimated_seconds, 0),
      task_estimated_seconds: taskEstimated, actual_seconds: actual, difference_seconds: actual - taskEstimated,
      evidence: { plans, tasks, completed_tasks: completed, delayed_tasks: delayed, closed_executions: closed, active_executions: executions.filter(e => e.ended_at === null) },
    };
  }
  async copyCompleted(sourcePlanId: string, input: CopyInput): Promise<{ plan: Plan; tasks: Task[] }> {
    await this.plan(sourcePlanId);
    for (const item of input.tasks) {
      const source = await this.task(item.task_id);
      if (source.plan_id !== sourcePlanId || source.status !== 'completed') throw new AppError(409, '해당 계획의 완료한 할 일만 복사할 수 있습니다.');
    }
    const planId = crypto.randomUUID();
    const timestamp = this.now();
    const p = input.plan;
    const writes = [
      statement('INSERT INTO plans (id, current_version, created_at, updated_at, owner_user_id) VALUES (?, 1, ?, ?, ?)', [planId, timestamp, timestamp, this.userId]),
      statement(`INSERT INTO plan_versions (plan_id, version, title, period_start, period_end, success_criteria, estimated_seconds, recorded_at)
        VALUES (?, 1, ?, ?, ?, ?, ?, ?)`, [planId, p.title, p.period_start, p.period_end, p.success_criteria, p.estimated_seconds, timestamp]),
    ];
    for (const source of input.tasks) {
      const id = crypto.randomUUID();
      // Values come from the DB inside the transaction, never from a client-supplied task payload.
      writes.push(statement(`INSERT INTO tasks (id, plan_id, content, priority, due_date, estimated_seconds, copied_from_task_id, created_at, updated_at)
        VALUES (?, ?, (SELECT content FROM tasks WHERE id = ? AND plan_id = ? AND ${this.taskScope}),
          (SELECT priority FROM tasks WHERE id = ? AND ${this.taskScope}), ?, (SELECT estimated_seconds FROM tasks WHERE id = ? AND ${this.taskScope}), ?, ?, ?)`,
        [id, planId, source.task_id, sourcePlanId, this.userId, source.task_id, this.userId, source.due_date, source.task_id, this.userId, source.task_id, timestamp, timestamp]));
      writes.push(statement(`INSERT INTO task_tags (task_id, tag_id) SELECT ?, tt.tag_id FROM task_tags tt JOIN tags g ON g.id=tt.tag_id WHERE tt.task_id = ? AND g.owner_user_id = ? AND tt.task_id IN(SELECT id FROM tasks WHERE ${this.taskScope})`, [id, source.task_id, this.userId, this.userId]));
    }
    await this.db.batch(writes);
    return { plan: await this.plan(planId), tasks: await this.tasks(planId, { sort: 'created_asc' }) };
  }
  async exportAll(): Promise<DatabaseExport> {
    const tables = ['plans', 'plan_versions', 'tasks', 'tags', 'task_tags', 'execution_logs'] as const;
    const orders = ['id', 'plan_id, version', 'id', 'id', 'task_id, tag_id', 'id'];
    const scopes = ["owner_user_id = ?", "plan_id IN(SELECT id FROM plans WHERE owner_user_id = ?)", this.taskScope, "owner_user_id = ?", "task_id IN(SELECT id FROM tasks WHERE " + this.taskScope + ") AND tag_id IN(SELECT id FROM tags WHERE owner_user_id = ?)", this.logScope];
    const snapshot = await this.db.batch(tables.map((table, i) => statement(`SELECT * FROM ${table} WHERE ${scopes[i]} ORDER BY ${orders[i]}`, i === 4 ? [this.userId,this.userId] : [this.userId])));
    const records = Object.fromEntries(tables.map((table, i) => [table, snapshot[i].results])) as unknown as ExportTables;
    return {
      schema_version: '3.0.0', exported_at: this.now(), timezone: 'Asia/Seoul',
      export_metadata: { application: 'aleph-t07-auth-diary', time_unit: 'seconds', consistency: 'transaction', table_counts: Object.fromEntries(tables.map((table, i) => [table, snapshot[i].results.length])) as Record<keyof ExportTables, number> },
      ...records,
    };
  }
}

export function koreanDate(value: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const get = (name: string) => parts.find(p => p.type === name)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
