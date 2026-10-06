import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { DatabaseExport, ExecutionLog } from '../../src/shared/types';

const planInput = { title: '2차 UI 테스트', period_start: '2026-10-01', period_end: '2026-10-09', success_criteria: '브라우저 자동 검증', estimated_seconds: 7200 };
async function create(request: APIRequestContext, title: string, content = '2차 UI 할 일', due: string | null = '2026-10-02') {
  const plan = await (await request.post('/api/plans', { data: { ...planInput, title } })).json();
  const task = await (await request.post(`/api/plans/${plan.id}/tasks`, { data: { content, priority: 'high', tags: ['브라우저'], due_date: due, estimated_seconds: 600 } })).json();
  return { plan, task };
}
async function select(page: Page, title: string) {
  await page.goto('/'); await page.getByRole('button').filter({ hasText: title }).first().click();
  await expect(page.locator('.plan-detail h2')).toHaveText(title);
  await expect(page.getByTestId('task-card')).toHaveCount(1);
}
const logs = async (request: APIRequestContext, taskId: string): Promise<ExecutionLog[]> => await (await request.get(`/api/tasks/${taskId}/executions`)).json();

test('start is saved immediately and restored after reload; finish records real elapsed time and keeps estimate', async ({ page, request }) => {
  const { plan, task } = await create(request, 'UI 시작 새로고침 테스트'); await select(page, plan.title);
  await page.getByRole('button', { name: '시작', exact: true }).click();
  await expect(page.getByTestId('active-execution')).toBeVisible();
  const [open] = await logs(request, task.id); expect(open.ended_at).toBeNull(); expect(open.started_at).toBeTruthy();
  await page.reload(); await expect(page.getByTestId('active-execution')).toBeVisible();
  await expect(page.getByTestId('active-execution')).toContainText(/경과 [1-9]\d*초/);
  await page.getByRole('button', { name: '완료', exact: true }).click();
  await expect(page.getByRole('button', { name: '진행 중으로 되돌리기' })).toBeVisible();
  const [closed] = await logs(request, task.id); expect(closed.id).toBe(open.id); expect(closed.ended_at).not.toBeNull();
  expect(closed.actual_seconds).toBe(Math.floor((Date.parse(closed.ended_at!) - Date.parse(closed.started_at)) / 1000));
  expect(closed.actual_seconds).toBeGreaterThanOrEqual(1);
  const stored = await (await request.get(`/api/tasks/${task.id}`)).json(); expect(stored.estimated_seconds).toBe(600);
  await page.getByText('실행 기록 (1개)', { exact: true }).click(); await expect(page.getByTestId('execution-record')).toContainText(`${closed.actual_seconds}초`);
  await page.screenshot({ path: 'evidence/t07/stage2/browser/phase2-execution.png', fullPage: true });
});

test('twenty immediate UI finish clicks create only one closed log', async ({ page, request }) => {
  const { plan, task } = await create(request, 'UI 완료 연타 테스트'); await select(page, plan.title);
  await page.getByRole('button', { name: '시작', exact: true }).click();
  const finish = page.getByRole('button', { name: '완료', exact: true }); await expect(finish).toBeEnabled();
  await finish.evaluate(element => { for (let i = 0; i < 20; i++) (element as HTMLButtonElement).click(); });
  await expect(page.getByRole('button', { name: '진행 중으로 되돌리기' })).toBeVisible();
  const rows = await logs(request, task.id); expect(rows).toHaveLength(1); expect(rows[0].ended_at).not.toBeNull();
  await page.reload(); await expect(page.getByRole('button', { name: '진행 중으로 되돌리기' })).toBeVisible();
  expect(await logs(request, task.id)).toEqual(rows);
});

test('reopen and rerun preserve both execution histories and one completed task count', async ({ page, request }) => {
  const { plan, task } = await create(request, 'UI 되돌리기 재실행 테스트'); await select(page, plan.title);
  await page.getByRole('button', { name: '시작', exact: true }).click(); await page.getByRole('button', { name: '완료', exact: true }).click();
  await expect(page.getByRole('button', { name: '진행 중으로 되돌리기' })).toBeVisible(); const before = await logs(request, task.id);
  await page.getByRole('button', { name: '진행 중으로 되돌리기' }).click(); await expect(page.getByRole('button', { name: '시작', exact: true })).toBeVisible();
  expect(await logs(request, task.id)).toEqual(before);
  await page.getByRole('button', { name: '시작', exact: true }).click(); await page.getByRole('button', { name: '완료', exact: true }).click();
  await expect(page.getByRole('button', { name: '진행 중으로 되돌리기' })).toBeVisible();
  await page.getByText('실행 기록 (2개)', { exact: true }).click(); await expect(page.getByTestId('execution-record')).toHaveCount(2);
  const after = await logs(request, task.id); expect(after[0]).toEqual(before[0]); expect(after[1].id).not.toBe(before[0].id);
  await page.getByLabel('돌아보기 범위').selectOption('selected');
  await expect(page.getByTestId('metric-completed')).toContainText('1');
  expect((await (await request.get(`/api/review?plan_id=${plan.id}`)).json()).completed_count).toBe(1);
});

test('UI review shows actual DB totals and clicking a number reveals supporting records', async ({ page, request }) => {
  const { plan, task } = await create(request, 'UI 돌아보기 근거 테스트', '지연 근거 할 일', '2000-01-01');
  await request.post(`/api/tasks/${task.id}/start`, { data: { request_id: crypto.randomUUID() } });
  const [open] = await logs(request, task.id);
  await request.post(`/api/tasks/${task.id}/executions/${open.id}/finish`, { data: { request_id: crypto.randomUUID() } });
  const review = await (await request.get(`/api/review?plan_id=${plan.id}`)).json();
  await select(page, plan.title); await page.getByLabel('돌아보기 범위').selectOption('selected');
  await expect(page.getByTestId('metric-plans')).toContainText('1'); await expect(page.getByTestId('metric-delayed')).toContainText('1');
  await expect(page.getByTestId('metric-estimated')).toContainText('600초'); await expect(page.getByTestId('metric-actual')).toContainText(`${review.actual_seconds}초`);
  await expect(page.getByTestId('metric-difference')).toContainText(`${review.actual_seconds - 600}초`); await expect(page.getByTestId('plan-estimate')).toContainText('7200초');
  await page.getByTestId('metric-delayed').click(); await expect(page.locator('#evidence-delayed')).toContainText('지연 근거 할 일'); await expect(page.locator('#evidence-delayed')).toBeVisible();
  await page.getByTestId('metric-actual').click(); await expect(page.locator('#evidence-actual')).toContainText(open.id);
  await page.screenshot({ path: 'evidence/t07/stage2/browser/phase2-review.png', fullPage: true });
});

test('UI copies completed task to new plan with new deadline, new IDs, source link and no execution history', async ({ page, request }) => {
  const payload = '<script>window.__copyXss=1</script>';
  const { plan, task } = await create(request, 'UI 다음 계획 복사 테스트', payload);
  const open = await (await request.post(`/api/tasks/${task.id}/start`, { data: { request_id: crypto.randomUUID() } })).json();
  await request.post(`/api/tasks/${task.id}/executions/${open.id}/finish`, { data: { request_id: crypto.randomUUID() } });
  const sourceTask = await (await request.get(`/api/tasks/${task.id}`)).json(); const sourceLogs = await logs(request, task.id);
  await select(page, plan.title); await page.getByRole('button', { name: '완료한 일을 다음 계획으로 복사' }).click();
  await page.getByLabel('다음 계획 제목').fill('UI 새 다음 계획'); await page.getByLabel('다음 계획 시작일').fill('2026-10-10'); await page.getByLabel('다음 계획 종료일').fill('2026-10-17');
  await page.getByLabel('다음 계획 성공 기준').fill('복사 확인'); await page.getByLabel(`복사 선택: ${payload}`, { exact: true }).check();
  await page.getByLabel(`새 마감일: ${payload}`, { exact: true }).fill('2026-10-15');
  await page.getByRole('button', { name: '다음 계획 생성 및 복사' }).click(); await expect(page.locator('.plan-detail h2')).toHaveText('UI 새 다음 계획');
  const newPlanId = await page.locator('.plan-detail .id code').innerText(); expect(newPlanId).not.toBe(plan.id);
  const [copied] = await (await request.get(`/api/plans/${newPlanId}/tasks`)).json();
  expect(copied.id).not.toBe(task.id); expect(copied.copied_from_task_id).toBe(task.id); expect(copied.due_date).toBe('2026-10-15'); expect(copied.tags).toEqual(sourceTask.tags);
  expect(await logs(request, copied.id)).toEqual([]); expect(await logs(request, task.id)).toEqual(sourceLogs); expect(await (await request.get(`/api/tasks/${task.id}`)).json()).toEqual(sourceTask);
  await expect(page.getByTestId('task-card')).toContainText(payload); expect(await page.evaluate(() => (window as unknown as { __copyXss?: number }).__copyXss)).toBeUndefined();
});

test('one downloaded JSON contains the whole DB and retains IDs/relations/timestamps after reading', async ({ page, request }) => {
  const { plan, task } = await create(request, 'UI 전체 JSON 테스트');
  const open = await (await request.post(`/api/tasks/${task.id}/start`, { data: { request_id: crypto.randomUUID() } })).json();
  await request.post(`/api/tasks/${task.id}/executions/${open.id}/finish`, { data: { request_id: crypto.randomUUID() } });
  await page.goto('/'); const downloads: string[] = []; page.on('download', d => downloads.push(d.suggestedFilename()));
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: '전체 JSON 다운로드' }).click(); const download = await pending;
  expect(download.suggestedFilename()).toBe('t07-diary.json');
  const path = await download.path(); const data: DatabaseExport = JSON.parse(await readFile(path!, 'utf8'));
  expect(downloads).toEqual(['t07-diary.json']); expect(data.plans.some(p => p.id === plan.id)).toBe(true); expect(data.tasks.some(t => t.id === task.id && t.plan_id === plan.id)).toBe(true);
  expect(data.execution_logs.find(log => log.id === open.id)?.started_at).toBe(open.started_at);
  expect(data.export_metadata.table_counts.execution_logs).toBe(data.execution_logs.length);
  const schema = JSON.parse(await readFile(new URL('../../contracts/pds-schema-v3.json', import.meta.url), 'utf8'));
  const ajv = new Ajv2020({ strict: false }); addFormats(ajv); const validate = ajv.compile(schema);
  expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
  const taskIds = new Set(data.tasks.map(t => t.id)); const planIds = new Set(data.plans.map(p => p.id)); const tagIds = new Set(data.tags.map(t => t.id));
  expect(data.tasks.every(t => planIds.has(t.plan_id) && (!t.copied_from_task_id || taskIds.has(t.copied_from_task_id)))).toBe(true);
  expect(data.execution_logs.every(log => taskIds.has(log.task_id))).toBe(true); expect(data.task_tags.every(link => taskIds.has(link.task_id) && tagIds.has(link.tag_id))).toBe(true);
});

test('lost start/finish responses can be retried with identical request IDs without duplicate DB changes', async ({ page, request }) => {
  const { plan, task } = await create(request, 'UI 통신 재시도 테스트'); await select(page, plan.title);
  const startKeys: string[] = []; let loseStart = true;
  await page.route(`**/api/tasks/${task.id}/start`, async route => {
    startKeys.push(route.request().postDataJSON().request_id);
    if (loseStart) { loseStart = false; await route.fetch(); await route.abort('failed'); } else await route.continue();
  });
  await page.getByRole('button', { name: '시작', exact: true }).click(); await expect(page.getByRole('alert')).toBeVisible();
  expect(await logs(request, task.id)).toHaveLength(1);
  await page.getByRole('button', { name: '시작', exact: true }).click(); await expect(page.getByTestId('active-execution')).toBeVisible();
  expect(startKeys).toHaveLength(2); expect(startKeys[0]).toBe(startKeys[1]);
  const [open] = await logs(request, task.id); const finishKeys: string[] = []; let loseFinish = true;
  await page.route(`**/api/tasks/${task.id}/executions/${open.id}/finish`, async route => {
    finishKeys.push(route.request().postDataJSON().request_id);
    if (loseFinish) { loseFinish = false; await route.fetch(); await route.abort('failed'); } else await route.continue();
  });
  await page.getByRole('button', { name: '완료', exact: true }).click(); await expect(page.getByRole('alert')).toBeVisible();
  const before = await logs(request, task.id); expect(before[0].ended_at).not.toBeNull();
  await page.getByRole('button', { name: '완료', exact: true }).click(); await expect(page.getByRole('button', { name: '진행 중으로 되돌리기' })).toBeVisible();
  expect(finishKeys).toHaveLength(2); expect(finishKeys[0]).toBe(finishKeys[1]); expect(await logs(request, task.id)).toEqual(before);
});
