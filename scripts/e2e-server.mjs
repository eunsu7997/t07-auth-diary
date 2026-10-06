import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const directory = mkdtempSync(join(tmpdir(), 't06-browser-'));
const child = spawn(process.execPath, ['--import', 'tsx', 'src/server/local.ts'], {
  stdio: 'inherit', env: { ...process.env, T07_PORT: '3107', T07_DB_PATH: join(directory, 'test.sqlite'), BETTER_AUTH_SECRET: randomBytes(48).toString('hex'), NODE_ENV: 'test', T07_AUTH_TEST_FIXTURES: '1' },
});
let closing = false;
function close() { if (!closing) { closing = true; child.kill(); } }
child.on('exit', code => { rmSync(directory, { recursive: true, force: true }); process.exit(code ?? 0); });
process.on('SIGINT', close); process.on('SIGTERM', close);
