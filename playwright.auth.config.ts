import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('.browser');
export default defineConfig({
  testDir: './tests/auth-browser', workers: 1,
  reporter: [['list'], ['json', { outputFile: 'evidence/t07/stage2-1/browser-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:3107', browserName: 'chromium', headless: true, trace: 'off', screenshot: 'off', video: 'off' },
  webServer: { command: 'node scripts/e2e-server.mjs', url: 'http://127.0.0.1:3107/api/health', reuseExistingServer: false, timeout: 30000 },
});
