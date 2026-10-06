import './block-remote.mjs';
// Read-only production verification. Never create fixture data in remote D1.
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('.browser');
const { chromium, expect } = await import('@playwright/test');
const url = 'https://aleph-t06-pds-diary.aleph-t04-eunsu.workers.dev';
const browser = await chromium.launch();
const checks = [];
try {
  const contexts = [await browser.newContext(), await browser.newContext()];
  const snapshots = [];
  for (const [index, context] of contexts.entries()) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto(url);
    expect(response.status()).toBe(200);
    await expect(page.getByRole('heading', { name: '플랜두씨 다이어리', exact: true })).toBeVisible();
    await expect(page.getByTestId('metric-plans').locator('strong')).toHaveText('0');
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
    const snapshot = await page.evaluate(async () => {
      const values = {};
      for (const path of ['health', 'plans', 'review', 'export']) {
        const response = await fetch(`/api/${path}`);
        if (!response.ok) throw new Error(`${path}: ${response.status}`);
        values[path] = await response.json();
      }
      return values;
    });
    expect(snapshot.health.storage).toBe('cloudflare-d1');
    expect(snapshot.plans).toEqual([]);
    for (const key of ['plan_count', 'completed_count', 'delayed_count', 'task_estimated_seconds', 'actual_seconds', 'difference_seconds']) expect(snapshot.review[key]).toBe(0);
    for (const key of ['plans', 'plan_versions', 'tasks', 'tags', 'task_tags', 'execution_logs']) expect(snapshot.export[key]).toEqual([]);
    if (index === 0) {
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: '전체 JSON 다운로드' }).click();
      const download = await downloading;
      expect(download.suggestedFilename()).toBe('t06-diary.json');
      const data = JSON.parse(await readFile(await download.path(), 'utf8'));
      const ajv = new Ajv2020({ strict: false }); addFormats(ajv);
      const validate = ajv.compile(JSON.parse(await readFile('contracts/pds-schema-v2.json', 'utf8')));
      expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
      await writeFile('evidence/public-export-empty.json', JSON.stringify(data, null, 2) + '\n');
      checks.push('single JSON download matches schema');
      await page.screenshot({ path: 'evidence/public-empty.png', fullPage: true });
    }
    await page.reload();
    await expect(page.getByTestId('metric-plans').locator('strong')).toHaveText('0');
    expect(errors).toEqual([]);
    snapshots.push(snapshot.plans);
    checks.push(`isolated browser context ${index + 1}: anonymous UI, D1 reads, zero aggregates, reload, no localStorage data, no JS errors`);
    await context.close();
  }
  expect(snapshots[0]).toEqual(snapshots[1]);
  checks.push('two isolated browser sessions return identical DB data');
  await writeFile('evidence/public-verification.json', JSON.stringify({ verified_at: new Date().toISOString(), url, mode: 'read-only; no production fixtures', checks, passed: true, pending: 'User-entered real records required to verify production writes and nonempty persistence.' }, null, 2) + '\n');
  console.log(JSON.stringify({ url, checks, passed: true }, null, 2));
} finally { await browser.close(); }
