import { spawn } from 'node:child_process';
const children = [
  spawn(process.execPath, ['--import', './scripts/local-env.mjs', '--import', 'tsx', 'src/server/local.ts'], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development', BETTER_AUTH_URL: 'http://127.0.0.1:5177' } }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
];
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) { child.on('error', () => close(1)); child.on('exit', code => close(code ?? 0)); }
process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
