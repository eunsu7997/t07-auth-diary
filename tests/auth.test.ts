import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { LocalDatabase } from '../src/server/local-db';
import { createAuth } from '../src/server/auth';
import { createApp } from '../src/server/app';
import { LOGIN_FAILURE } from '../src/client/auth-client';

let db: LocalDatabase;
let auth: ReturnType<typeof createAuth>;
let app: ReturnType<typeof createApp>;
let password: string;
const base = 'http://127.0.0.1:3007';
const email = 'fixture@example.invalid';
const random = () => Array.from(randomBytes(40), b => b.toString(16).padStart(2, '0')).join('');
beforeEach(() => {
  db = new LocalDatabase(':memory:');
  auth = createAuth(db.sqlite, random(), base);
  app = createApp(db, auth);
  password = random();
});
afterEach(() => db.close());
async function request(path: string, body?: unknown, cookie?: string) {
  return app.request(base + path, { method: body === undefined ? 'GET' : 'POST', headers: {
    ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: base }),
    ...(cookie ? { Cookie: cookie } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function signup(address = email, name = 'Temporary fixture') {
  return request('/api/auth/sign-up/email', { email: address, password, name });
}
function cookies(response: Response) {
  return response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
}
async function loggedIn() {
  const response = await signup();
  expect(response.status).toBe(200);
  return cookies(response);
}
describe('T07 phase 1 authentication (temporary fixtures only)', () => {
  it('signs up and stores exactly one user and credential account', async () => {
    const response = await signup();
    expect(response.status).toBe(200);
    expect(Number(db.sqlite.prepare('SELECT COUNT(*) AS n FROM user').get()!.n)).toBe(1);
    expect(Number(db.sqlite.prepare("SELECT COUNT(*) AS n FROM account WHERE providerId='credential'").get()!.n)).toBe(1);
  });
  it('rejects duplicate email without adding another account', async () => {
    await signup();
    const duplicate = await signup();
    expect(duplicate.ok).toBe(false);
    expect(Number(db.sqlite.prepare('SELECT COUNT(*) AS n FROM user').get()!.n)).toBe(1);
  });
  it('signs in with the correct password', async () => {
    await signup();
    const response = await request('/api/auth/sign-in/email', { email, password });
    expect(response.status).toBe(200);
    expect(Boolean(cookies(response))).toBe(true);
  });
  it('rejects an incorrect password', async () => {
    await signup();
    const response = await request('/api/auth/sign-in/email', { email, password: random() });
    expect(response.status).toBe(401);
  });
  it('rejects an unknown email', async () => {
    const response = await request('/api/auth/sign-in/email', { email: 'missing@example.invalid', password });
    expect(response.status).toBe(401);
  });
  it('returns identical login failure codes/messages; UI uses one fixed message', async () => {
    await signup();
    const wrong = await request('/api/auth/sign-in/email', { email, password: random() });
    const missing = await request('/api/auth/sign-in/email', { email: 'missing@example.invalid', password });
    const a = await wrong.json() as { code: string; message: string }, b = await missing.json() as { code: string; message: string };
    expect(a.code === b.code && a.message === b.message).toBe(true);
    expect(LOGIN_FAILURE).toBe('이메일 또는 비밀번호를 확인하세요.');
  });
  it('gets current user through the server session endpoint without exposing token', async () => {
    const cookie = await loggedIn();
    const response = await request('/api/session', undefined, cookie);
    expect(response.status).toBe(200);
    const data = await response.json() as { user: { id: string }; expiresAt: string };
    expect(Boolean(data.user.id)).toBe(true);
    expect('token' in data || 'session' in data).toBe(false);
  });
  it('signs out and rejects the exact old cookie on session and diary APIs', async () => {
    const cookie = await loggedIn();
    expect((await request('/api/auth/sign-out', {}, cookie)).status).toBe(200);
    expect((await request('/api/session', undefined, cookie)).status).toBe(401);
    expect((await request('/api/plans', undefined, cookie)).status).toBe(401);
    expect(Number(db.sqlite.prepare('SELECT COUNT(*) AS n FROM session').get()!.n)).toBe(0);
  });
  it('rejects unauthenticated diary read/write/export', async () => {
    for (const path of ['/api/plans', '/api/review', '/api/export']) expect((await request(path)).status).toBe(401);
    expect((await request('/api/plans', {})).status).toBe(401);
  });
  it('stores salted hashes, never the plaintext, and same passwords differ', async () => {
    await signup(); await signup('second@example.invalid');
    const rows = db.sqlite.prepare('SELECT password FROM account').all();
    expect(rows.length).toBe(2);
    expect(rows.every(r => typeof r.password === 'string' && r.password !== password)).toBe(true);
    expect(rows[0].password !== rows[1].password).toBe(true);
    expect(JSON.stringify(db.sqlite.prepare('SELECT * FROM user').all()).includes(password)).toBe(false);
  });
  it('expires sessions according to DB expiration and uses no cookie cache', async () => {
    const cookie = await loggedIn();
    expect(auth.options.session?.cookieCache?.enabled).toBe(false);
    expect(auth.options.session?.expiresIn).toBe(604800);
    db.sqlite.prepare('UPDATE session SET expiresAt = ?').run(Date.now() - 1000);
    expect((await request('/api/session', undefined, cookie)).status).toBe(401);
  });
  it('sets HttpOnly/Lax locally and Secure on HTTPS; no token URL', async () => {
    const response = await signup();
    const header = response.headers.get('set-cookie') ?? '';
    expect(header.includes('HttpOnly')).toBe(true);
    expect(/SameSite=Lax/i.test(header)).toBe(true);
    expect(response.headers.has('location')).toBe(false);
    const httpsAuth = createAuth(db.sqlite, random(), 'https://t07.example.invalid');
    expect(httpsAuth.options.advanced?.useSecureCookies).toBe(true);
  });
  it('supports installed changePassword API and rejects the old password', async () => {
    const cookie = await loggedIn();
    const nextPassword = random();
    const result = await request('/api/auth/change-password', { currentPassword: password, newPassword: nextPassword, revokeOtherSessions: true }, cookie);
    expect(result.status).toBe(200);
    expect((await request('/api/auth/sign-in/email', { email, password })).status).toBe(401);
    expect((await request('/api/auth/sign-in/email', { email, password: nextPassword })).status).toBe(200);
  });
});
