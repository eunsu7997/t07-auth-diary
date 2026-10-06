import { type Page } from '@playwright/test';
import { test, expect } from './fixtures';
const input = { title: '브라우저 테스트 전용', period_start: '2026-10-02', period_end: '2026-10-09', success_criteria: '테스트 기준', estimated_seconds: 3600 };

async function selectPlan(page: Page, title: string) {
  await page.goto('/');
  await page.getByRole('button').filter({ hasText: title }).first().click();
  await expect(page.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible();
}

test('browser creates plan, edits with stable ID, and displays original history', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '새 계획', exact: true }).click();
  await page.getByLabel('계획 제목').fill('직접 입력한 브라우저 계획');
  await page.getByLabel('시작일', { exact: true }).fill('2026-10-02');
  await page.getByLabel('종료일', { exact: true }).fill('2026-10-09');
  await page.getByLabel('성공 기준').fill('최초 성공 기준');
  await page.getByLabel('계획 예상 시간 (분)').fill('60');
  await page.getByRole('button', { name: '계획 생성', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: '직접 입력한 브라우저 계획', exact: true })).toBeVisible();
  const id = await page.locator('.plan-detail .id code').innerText();
  await page.getByRole('button', { name: '계획 수정', exact: true }).click();
  await page.getByLabel('계획 제목').fill('수정한 브라우저 계획');
  await page.getByLabel('성공 기준').fill('수정 성공 기준');
  await page.getByRole('button', { name: '수정 저장', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: '수정한 브라우저 계획', exact: true })).toBeVisible();
  await expect(page.locator('.plan-detail .id code')).toHaveText(id);
  await page.getByText('수정 이력 (2개 버전)', { exact: true }).click();
  await expect(page.getByTestId('version-1')).toContainText('직접 입력한 브라우저 계획');
  await expect(page.getByTestId('version-1')).toContainText('최초 성공 기준');
  await expect(page.getByTestId('version-2')).toContainText('수정 성공 기준');
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: '수정한 브라우저 계획', exact: true })).toBeVisible();
  await page.screenshot({ path: 'evidence/t07/stage2/browser/phase1-desktop.png', fullPage: true });
});

test('browser adds five tasks, edits attributes, deletes, and re-reads from DB', async ({ page, request }) => {
  const created = await request.post('/api/plans', { data: { ...input, title: '할 일 CRUD 브라우저 테스트' } });
  const plan = await created.json();
  await selectPlan(page, plan.title);
  for (let i = 1; i <= 5; i++) {
    await page.getByLabel('할 일 내용', { exact: true }).fill(`실제 입력 UI 테스트 ${i}`);
    await page.getByLabel('우선순위', { exact: true }).selectOption('high');
    await page.getByLabel('태그 (쉼표로 구분)').fill('UI, 검증');
    await page.getByLabel('마감일', { exact: true }).fill('2026-10-04');
    await page.getByLabel('할 일 예상 시간 (분)').fill('10');
    await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
    await expect(page.getByTestId('task-card')).toHaveCount(i);
  }
  const card = page.getByTestId('task-card').filter({ hasText: '실제 입력 UI 테스트 1' });
  const id = await card.locator('code').innerText();
  await card.getByRole('button', { name: '수정', exact: true }).click();
  await page.getByLabel('할 일 내용', { exact: true }).fill('수정된 UI 할 일');
  await page.getByLabel('우선순위', { exact: true }).selectOption('low');
  await page.getByLabel('태그 (쉼표로 구분)').fill('수정');
  await page.getByRole('button', { name: '할 일 수정 저장' }).click();
  await expect(page.getByTestId('task-card').filter({ hasText: '수정된 UI 할 일' })).toContainText('낮음');
  const row = await (await request.get(`/api/tasks/${id}`)).json();
  expect(row.tags.map((t: { name: string }) => t.name)).toEqual(['수정']);
  page.once('dialog', dialog => dialog.accept());
  await page.getByTestId('task-card').filter({ hasText: '수정된 UI 할 일' }).getByRole('button', { name: '삭제' }).click();
  await expect(page.getByTestId('task-card')).toHaveCount(4);
  await page.reload();
  await expect(page.getByTestId('task-card')).toHaveCount(4);
  expect((await request.get(`/api/plans/${plan.id}/tasks`)).status()).toBe(200);
});

test('browser filters and sorts actual server query results', async ({ page, request }) => {
  const plan = await (await request.post('/api/plans', { data: { ...input, title: '필터 브라우저 테스트' } })).json();
  for (const task of [
    { content: '독서 A', priority: 'high', tags: ['독서'], due_date: '2026-10-03', estimated_seconds: 300 },
    { content: '독서 B', priority: 'low', tags: ['독서'], due_date: '2026-10-05', estimated_seconds: 600 },
    { content: '운동', priority: 'medium', tags: ['건강'], due_date: null, estimated_seconds: 900 },
  ]) await request.post(`/api/plans/${plan.id}/tasks`, { data: task });
  await selectPlan(page, plan.title);
  await page.getByLabel('내용 검색').fill('독서');
  await page.getByLabel('태그 필터').fill('독서');
  await page.getByLabel('우선순위 필터').selectOption('high');
  await page.getByLabel('마감일 끝').fill('2026-10-04');
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await expect(page.getByTestId('task-card')).toHaveCount(1);
  await expect(page.getByTestId('task-card')).toContainText('독서 A');
  await page.getByRole('button', { name: '초기화', exact: true }).click();
  await expect(page.getByTestId('task-card')).toHaveCount(3);
  await page.getByLabel('정렬', { exact: true }).selectOption('due_asc');
  await page.getByRole('button', { name: '적용', exact: true }).click();
  await expect(page.getByTestId('task-card').first()).toContainText('독서 A');
  await expect(page.getByTestId('task-card').last()).toContainText('운동');
});

test('script-like inputs remain visible text in plan, history, tasks and tags without executing', async ({ page, request }) => {
  const payload = '<script>window.__t06Xss=123</script>';
  const plan = await (await request.post('/api/plans', { data: { ...input, title: '문자열 안전성 테스트', success_criteria: payload } })).json();
  await request.post(`/api/plans/${plan.id}/tasks`, { data: { content: payload, priority: 'medium', tags: [payload], due_date: null, estimated_seconds: 60 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await selectPlan(page, plan.title);
  await expect(page.getByTestId('task-card')).toContainText(payload);
  await expect(page.locator('.plan-detail > .preserve')).toHaveText(payload);
  await page.getByText('수정 이력 (1개 버전)', { exact: true }).click();
  await expect(page.getByTestId('version-1')).toContainText(payload);
  expect(await page.evaluate(() => (window as unknown as { __t06Xss?: number }).__t06Xss)).toBeUndefined();
  expect(await page.locator('.plan-detail script, .tasks script').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('fresh anonymous browser rejects data; authenticated browser persists and another user is isolated', async ({ browser, request, context: original }) => {
  const plan = await (await request.post('/api/plans', { data: { ...input, title: '브라우저 종료 후 유지 테스트' } })).json();
  await request.post(`/api/plans/${plan.id}/tasks`, { data: { content: '서버에 남은 할 일', priority: 'low', tags: [], due_date: null, estimated_seconds: 60 } });
  const context = await browser.newContext(); const page = await context.newPage();
  await page.goto('/'); await expect(page.getByRole('button',{name:'로그인하기',exact:true})).toBeVisible();
  expect((await context.request.get('/api/plans')).status()).toBe(401);
  await context.addCookies(await original.cookies());
  await selectPlan(page,plan.title); await expect(page.getByTestId('task-card')).toContainText('서버에 남은 할 일');
  expect(await page.evaluate(()=>localStorage.length+sessionStorage.length)).toBe(0);
  await page.reload();await expect(page.getByTestId('task-card')).toContainText('서버에 남은 할 일');
  await context.clearCookies();
  const password = crypto.randomUUID()+crypto.randomUUID();
  expect((await context.request.post('/api/auth/sign-up/email',{data:{email:crypto.randomUUID()+'@example.invalid',name:'Other fixture',password}})).ok()).toBe(true);
  expect(await (await context.request.get('/api/plans')).json()).toEqual([]);
  expect((await context.request.get(`/api/plans/${plan.id}`)).status()).toBe(404);
  await page.reload();await expect(page.getByRole('button').filter({hasText:plan.title})).toHaveCount(0);
  await context.close();
});

test('failed save preserves draft and allows retry', async ({ page, request }) => {
  const plan = await (await request.post('/api/plans', { data: { ...input, title: '실패 처리 테스트' } })).json();
  await selectPlan(page, plan.title);
  await page.getByLabel('할 일 내용', { exact: true }).fill('실패해도 남는 초안');
  await page.route(`**/api/plans/${plan.id}/tasks`, async route => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '테스트용 저장 실패' }) });
    else await route.continue();
  });
  await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('테스트용 저장 실패');
  await expect(page.getByLabel('할 일 내용', { exact: true })).toHaveValue('실패해도 남는 초안');
  await page.unroute(`**/api/plans/${plan.id}/tasks`);
  await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
  await expect(page.getByTestId('task-card')).toContainText('실패해도 남는 초안');
});

test('mobile layout loads without runtime errors or horizontal overflow', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await request.post('/api/plans',{data:{...input,title:'Mobile fixture'}});
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('플랜두씨 다이어리');
  await expect(page.getByRole('button', { name: '새 계획', exact: true })).toBeVisible();
  await expect(page.locator('.plan-detail')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'evidence/t07/stage2/browser/phase1-mobile.png', fullPage: true });
});
