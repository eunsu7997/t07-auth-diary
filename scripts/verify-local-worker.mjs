// Temporary fixtures on loopback workerd + local D1 only. No credentials in output.
import https from 'node:https';
import { randomBytes } from 'node:crypto';
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const base = 'https://localhost:8787';
const results = [];
const password = randomBytes(32).toString('hex');
const email = `worker-${randomBytes(8).toString('hex')}@example.invalid`;
function call(path, body, cookie) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = https.request(base + path, {
      // Only this local self-signed TLS connection bypasses certificate verification.
      rejectUnauthorized: false,
      method: payload ? 'POST' : 'GET',
      headers: { ...(payload ? { 'Content-Type': 'application/json', Origin: base } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    }, res => {
      let text = '';
      res.on('data', chunk => text += chunk);
      res.on('end', () => { try { resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(text) }); } catch { reject(new Error('Unexpected local Worker response format')); } });
    });
    req.on('error', () => reject(new Error('Local Worker connection failed')));
    req.end(payload);
  });
}
function check(label, passed) {
  results.push({ label, passed: Boolean(passed) });
  if (!passed) throw new Error(`Verification failed: ${label}`);
}
try {
  check('unauthenticated diary returns 401', (await call('/api/plans')).status === 401);
  const signup = await call('/api/auth/sign-up/email', { email, password, name: 'Temporary Worker fixture' });
  check('signup on workerd and local D1', signup.status === 200);
  const attributes = signup.headers['set-cookie'] ?? [];
  const cookie = attributes.map(value => value.split(';')[0]).join('; ');
  check('HTTPS HttpOnly Secure SameSite=Lax cookie', attributes.some(value => /HttpOnly/i.test(value) && /Secure/i.test(value) && /SameSite=Lax/i.test(value)));
  check('no session cookie cache', !attributes.some(value => value.includes('session_data')));
  check('duplicate signup rejected', (await call('/api/auth/sign-up/email', { email, password, name: 'Duplicate' })).status === 422);
  const session = await call('/api/session', undefined, cookie);
  check('server identifies current user without token response', session.status === 200 && session.data.user.id && !('token' in session.data));
  check('authenticated diary accessible', (await call('/api/plans', undefined, cookie)).status === 200);
  const wrong = await call('/api/auth/sign-in/email', { email, password: randomBytes(32).toString('hex') });
  const missing = await call('/api/auth/sign-in/email', { email: 'missing@example.invalid', password });
  check('login failures are identical', wrong.status === 401 && missing.status === 401 && wrong.data.code === missing.data.code && wrong.data.message === missing.data.message);
  check('correct password login', (await call('/api/auth/sign-in/email', { email, password })).status === 200);
  check('logout succeeds', (await call('/api/auth/sign-out', {}, cookie)).status === 200);
  check('old cookie rejected for session', (await call('/api/session', undefined, cookie)).status === 401);
  check('old cookie rejected for diary', (await call('/api/plans', undefined, cookie)).status === 401);
  const secondEmail = `worker-${randomBytes(8).toString('hex')}@example.invalid`;
  check('second same-password fixture signs up', (await call('/api/auth/sign-up/email', { email: secondEmail, password, name: 'Temporary Worker fixture 2' })).status === 200);
  const directory = '.wrangler/state/v3/d1';
  const files = readdirSync(directory, { recursive: true }).filter(file => String(file).endsWith('.sqlite')).filter(file => {
    const candidate = new DatabaseSync(join(directory, String(file)), { readOnly: true });
    const found = candidate.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='account'").get().n === 1;
    candidate.close();
    return found;
  });
  check('exactly one isolated local D1 file', files.length === 1);
  const db = new DatabaseSync(join(directory, String(files[0])), { readOnly: true });
  const accounts = db.prepare('SELECT a.password FROM account a JOIN user u ON u.id=a.userId WHERE u.email IN (?, ?)').all(email, secondEmail);
  check('D1 stores salted credentials and no plaintext', accounts.length === 2 && accounts.every(row => typeof row.password === 'string' && row.password !== password) && accounts[0].password !== accounts[1].password);
  db.close();
  const report = { verified_at: new Date().toISOString(), environment: 'loopback workerd; local D1; temporary fixtures; not actual-use evidence', remote_access: false, results, passed: results.length, failed: 0 };
  writeFileSync('evidence/t07/stage1/worker-results.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ environment: report.environment, passed: report.passed, failed: 0 }));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Local Worker verification failed');
  process.exitCode = 1;
}
