import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
const random = (n: number) => Array.from(randomBytes(n), b => b.toString(16).padStart(2, '0')).join('');

test('anonymous screen hides diary and rejects direct APIs; storage has no auth token', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '로그인', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '내 계획', exact: true })).toHaveCount(0);
  const status = await page.evaluate(async () => (await fetch('/api/plans')).status);
  expect(status).toBe(401);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});

test('signup, reload, logout and login work without browser token storage or script execution', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.name));
  const email = `browser-${random(8)}@example.invalid`;
  const password = random(30);
  const script = '<img src=x onerror="window.__t07Injected=1">';
  await page.goto('/');
  await page.getByRole('button', { name: '가입 화면으로', exact: true }).click();
  await page.getByLabel('표시 이름').fill(script);
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  await page.getByRole('button', { name: '가입하기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '내 계획', exact: true })).toBeVisible();
  expect(await page.evaluate(() => Boolean((window as unknown as { __t07Injected?: number }).__t07Injected))).toBe(false);
  expect(await page.locator('[aria-label="로그인 상태"] img').count()).toBe(0);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: '내 계획', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByRole('heading', { name: '로그인', exact: true })).toBeVisible();
  expect(await page.evaluate(async () => (await fetch('/api/plans')).status)).toBe(401);
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  await page.getByRole('button', { name: '로그인하기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '내 계획', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  expect(errors.length).toBe(0);
});

test('unknown email and wrong password show the same fixed message', async ({ page, request }) => {
  const email = `failure-${random(8)}@example.invalid`;
  const password = random(30);
  const result = await request.post('/api/auth/sign-up/email', { data: { name: 'Fixture', email, password } });
  expect(result.status()).toBe(200);
  // API fixture cookies belong to the request context, not the anonymous page.
  await page.context().clearCookies();
  await page.goto('/');
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page.getByLabel('비밀번호', { exact: true }).fill(random(30));
  await page.getByRole('button', { name: '로그인하기', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('이메일 또는 비밀번호를 확인하세요.');
  await page.getByLabel('이메일', { exact: true }).fill('unknown@example.invalid');
  await page.getByRole('button', { name: '로그인하기', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('이메일 또는 비밀번호를 확인하세요.');
});

test('expired server session returns the browser to login after a rejected diary request', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '가입 화면으로', exact: true }).click();
  await page.getByLabel('표시 이름').fill('Temporary session fixture');
  await page.getByLabel('이메일', { exact: true }).fill(`expire-${random(8)}@example.invalid`);
  await page.getByLabel('비밀번호', { exact: true }).fill(random(30));
  await page.getByRole('button', { name: '가입하기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '내 계획', exact: true })).toBeVisible();
  await page.context().clearCookies();
  const denied = page.waitForResponse(response => response.url().endsWith('/api/export'));
  await page.getByRole('button', { name: '전체 JSON 다운로드', exact: true }).click();
  expect((await denied).status()).toBe(401);
  await expect(page.getByRole('heading', { name: '로그인', exact: true })).toBeVisible();
});

test('authenticated account explains permanent data deletion and requires confirmation', async ({ page, context }) => {
  const response=await context.request.post('/api/auth/sign-up/email',{data:{email:`notice-${random(8)}@example.invalid`,name:'Temporary notice fixture',password:random(30)}});
  expect(response.ok()).toBe(true);await page.goto('/');
  const deletion = page.locator('[aria-label="계정 삭제"]');
  await expect(deletion.getByText('내 계정을 삭제하면 내 계획·할 일·계획 버전·실행 기록과 계정 자료가 함께 삭제되며 복구할 수 없습니다. 모든 로그인 세션도 무효화됩니다.', {exact:true})).toBeVisible();
  await expect(deletion.getByText('삭제 전에 화면 상단의 “전체 JSON 다운로드”로 내 자료를 파일 하나에 보관하는 것을 권장합니다. 로그아웃만으로는 자료가 삭제되지 않습니다.', {exact:true})).toBeVisible();
  await expect(deletion.getByLabel('삭제 확인용 현재 비밀번호')).toBeVisible();
  const button = deletion.getByRole('button', {name:'계정과 내 자료 영구 삭제',exact:true});
  const confirmation = deletion.getByRole('checkbox', {name:'내 자료가 함께 삭제되고 복구할 수 없음을 확인했습니다.'});
  await expect(confirmation).not.toBeChecked();
  await expect(button).toBeDisabled();
  await confirmation.check();await expect(button).toBeEnabled();
  await confirmation.uncheck();await expect(button).toBeDisabled();
  // No deletion is submitted: this browser test verifies disclosure and the UI gate.
});
