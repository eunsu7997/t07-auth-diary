import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocalDatabase } from '../src/server/local-db.ts';
import { createAuth } from '../src/server/auth.ts';
import { createApp } from '../src/server/app.ts';
import { Diary } from '../src/server/services.ts';
import AccountDeletionForm from '../src/client/AccountDeletionForm';
import { trustedBaseline } from '../scripts/stage3d/adapters.ts';

const base = 'http://127.0.0.1:3007';
const random = () => Array.from(randomBytes(40), b => b.toString(16).padStart(2, '0')).join('');
let db: LocalDatabase;
let app: ReturnType<typeof createApp>;
let auth: ReturnType<typeof createAuth>;
let a: Awaited<ReturnType<typeof fixture>>, b: Awaited<ReturnType<typeof fixture>>;
async function fixture(label: string) {
  const password = random();
  const response = await app.request(base + '/api/auth/sign-up/email', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ name: 'Automated deletion fixture only', email: label + '@example.invalid', password }),
  });
  expect(response.status).toBe(200);
  const id = ((await response.json()) as { user: { id: string } }).user.id;
  const cookie = response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const diary = new Diary(db, id);
  const plan = await diary.createPlan({ title: 'Synthetic fixture', period_start: '2026-10-01', period_end: '2026-10-02', success_criteria: 'Not actual usage', estimated_seconds: 60 });
  const task = await diary.createTask(plan.id, { content: 'Synthetic fixture', priority: 'medium', due_date: null, estimated_seconds: 60, tags: ['fixture'] });
  const log = await diary.start(task.id, crypto.randomUUID());
  await diary.finish(task.id, log.id, crypto.randomUUID());
  await diary.copyCompleted(plan.id, { plan: { title: 'Synthetic copy', period_start: '2026-10-01', period_end: '2026-10-02', success_criteria: 'Not usage', estimated_seconds: 60 }, tasks: [{ task_id: task.id, due_date: null }] });
  await db.batch([{ sql: 'INSERT INTO verification(id,identifier,value,expiresAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?)', params: [crypto.randomUUID(), 'reset-password:' + random(), id, new Date(Date.now() + 60_000).toISOString(), new Date().toISOString(), new Date().toISOString()] }]);
  return { id, cookie, password, plan, task, log, diary };
}
beforeEach(async () => {
  db = new LocalDatabase(':memory:');
  auth = createAuth(db.sqlite, random(), base, 'isolated-test');
  app = createApp(db, auth);
  a = await fixture('delete-a'); b = await fixture('keep-b');
});
afterEach(() => { vi.restoreAllMocks(); db.close(); });
it('the real importer rejects the new schema until its migration baseline is separately audited', () => {
  expect(() => trustedBaseline()).toThrow('MIGRATION_HASH_MISMATCH');
});
function request(cookie?: string, body: unknown = { password: a.password }, origin: string | null = base, ip = '192.0.2.1') {
  return app.request(base + '/api/account/delete', { method: 'POST', headers: {
    'Content-Type': 'application/json', 'cf-connecting-ip': ip, ...(cookie ? { Cookie: cookie } : {}), ...(origin === null ? {} : { Origin: origin }),
  }, body: JSON.stringify(body) });
}
async function fingerprint() {
  const rows = await Promise.all(['plans', 'plan_versions', 'tasks', 'tags', 'task_tags', 'execution_logs', 'user', 'session', 'account', 'verification', '_account_deletion_scope'].map(table => db.all(`SELECT * FROM ${table} ORDER BY rowid`)));
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
const markersEmpty = async () => expect((await db.all('SELECT * FROM _account_deletion_scope')).length).toBe(0);
async function businessSnapshot(diary: Diary) {
  const { exported_at: _time, ...records } = await diary.exportAll();
  return JSON.stringify(records);
}
it('rejects an incorrect password without deleting anything', async () => {
  const before = await fingerprint();
  expect((await request(a.cookie, { password: random() })).status).toBe(400);
  expect(await fingerprint() === before).toBe(true); await markersEmpty();
});
it('allows five wrong-password responses, then blocks even a correct password before verification or deletion batch', async () => {
  const before = await fingerprint();
  for (let i = 0; i < 5; i++) expect((await request(a.cookie, { password: random() })).status).toBe(400);
  const verify = vi.spyOn((await auth.$context).password, 'verify');
  const batch = vi.spyOn(db, 'batch');
  const response = await request(a.cookie);
  expect(response.status).toBe(429); expect(response.headers.has('Retry-After')).toBe(true);
  expect(verify).not.toHaveBeenCalled(); expect(batch).not.toHaveBeenCalled();
  expect(await fingerprint() === before).toBe(true); await markersEmpty();
  expect((await app.request(base + '/api/session', { headers: { Cookie: a.cookie } })).status).toBe(200);
});
it('A limit does not block B on the same IP or delete A when B deletes their own account', async () => {
  const beforeA = await businessSnapshot(a.diary);
  for (let i = 0; i < 5; i++) await request(a.cookie, { password: random() });
  expect((await request(a.cookie)).status).toBe(429);
  expect((await request(b.cookie, { password: b.password })).status).toBe(200);
  expect(await businessSnapshot(a.diary) === beforeA).toBe(true);
  expect((await app.request(base + '/api/session', { headers: { Cookie: a.cookie } })).status).toBe(200);
  expect((await app.request(base + '/api/session', { headers: { Cookie: b.cookie } })).status).toBe(401);
});
it('keys the deletion limit by both authenticated user and trusted request IP', async () => {
  for (let i = 0; i < 5; i++) await request(a.cookie, { password: random() });
  expect((await request(a.cookie)).status).toBe(429);
  expect((await request(a.cookie, { password: random() }, base, '192.0.2.2')).status).toBe(400);
  expect((await request(a.cookie)).status).toBe(429);
});
it('uses the existing lastRequest window and allows a new attempt after 60 seconds', async () => {
  for (let i = 0; i < 5; i++) await request(a.cookie, { password: random() });
  expect((await request(a.cookie)).status).toBe(429);
  const later = Date.now() + 60_001;
  vi.spyOn(Date, 'now').mockReturnValue(later);
  expect((await request(a.cookie, { password: random() })).status).toBe(400);
});
it('atomically permits only five of six concurrent password attempts', async () => {
  const before = await fingerprint();
  const responses = await Promise.all(Array.from({ length: 6 }, () => request(a.cookie, { password: random() })));
  expect(responses.filter(r => r.status === 400).length).toBe(5);
  expect(responses.filter(r => r.status === 429).length).toBe(1);
  expect(await fingerprint() === before).toBe(true); await markersEmpty();
});
it('rejects unauthenticated deletion', async () => {
  const before = await fingerprint(); expect((await request()).status).toBe(401);
  expect(await fingerprint() === before).toBe(true);
});
it.each([null, 'https://unrelated.example.invalid'])('requires the canonical same-origin header (%s)', async origin => {
  const before = await fingerprint(); expect((await request(a.cookie, undefined, origin)).status).toBe(403);
  expect(await fingerprint() === before).toBe(true);
});
it('rejects a caller-selected user ID', async () => {
  const before = await fingerprint(); expect((await request(a.cookie, { password: a.password, user_id: b.id })).status).toBe(400);
  expect(await fingerprint() === before).toBe(true);
});
it('deletes all A records and sessions, keeps all B records, clears cookies and rejects old sessions', async () => {
  const beforeB = await businessSnapshot(b.diary);
  const sessionB = await db.all('SELECT * FROM session WHERE userId=?', [b.id]);
  const credentialB = await db.all('SELECT * FROM account WHERE userId=?', [b.id]);
  // Also create a second A session; deletion must revoke every session, not just this browser.
  const second = await app.request(base + '/api/auth/sign-in/email', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'delete-a@example.invalid', password: a.password }) });
  const oldCookies = [a.cookie, second.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')];
  const response = await request(a.cookie);
  expect(response.status).toBe(200);
  expect(response.headers.getSetCookie().some(c => c.includes('Max-Age=0'))).toBe(true);
  for (const cookie of oldCookies) expect((await app.request(base + '/api/session', { headers: { Cookie: cookie } })).status).toBe(401);
  for (const [table, column] of [['user', 'id'], ['session', 'userId'], ['account', 'userId'], ['plans', 'owner_user_id'], ['tags', 'owner_user_id'], ['verification', 'value']]) {
    expect((await db.all(`SELECT * FROM ${table} WHERE ${column}=?`, [a.id])).length).toBe(0);
  }
  expect(await businessSnapshot(b.diary) === beforeB).toBe(true);
  expect(JSON.stringify(await db.all('SELECT * FROM session WHERE userId=?', [b.id])) === JSON.stringify(sessionB)).toBe(true);
  expect(JSON.stringify(await db.all('SELECT * FROM account WHERE userId=?', [b.id])) === JSON.stringify(credentialB)).toBe(true);
  expect((await app.request(base + '/api/session', { headers: { Cookie: b.cookie } })).status).toBe(200);
  expect((await db.all('PRAGMA foreign_key_check')).length).toBe(0);
  await markersEmpty();
});
it.each([
  'DELETE FROM plan_versions WHERE plan_id=?',
  'DELETE FROM execution_logs WHERE task_id=?',
  'UPDATE plan_versions SET title=title WHERE plan_id=?',
  'UPDATE execution_logs SET actual_seconds=actual_seconds+1 WHERE task_id=?',
])('retains ordinary immutable protection: %s', async sql => {
  const before = await fingerprint();
  await expect(db.batch([{ sql, params: [sql.includes('execution_logs') ? a.task.id : a.plan.id] }])).rejects.toThrow();
  expect(await fingerprint() === before).toBe(true);
});
it.each(['execution_logs', 'plan_versions'])('a deletion marker for A cannot delete B %s', async table => {
  const before = await fingerprint();
  await expect(db.batch([
    { sql: 'INSERT INTO _account_deletion_scope(user_id) VALUES (?)', params: [a.id] },
    { sql: `DELETE FROM ${table} WHERE ${table === 'execution_logs' ? 'task_id' : 'plan_id'}=?`, params: [table === 'execution_logs' ? b.task.id : b.plan.id] },
  ])).rejects.toThrow();
  expect(await fingerprint() === before).toBe(true); await markersEmpty();
});
it('ordinary updates cannot unlink copy provenance', async () => {
  const before = await fingerprint();
  await expect(db.batch([{ sql: 'UPDATE tasks SET copied_from_task_id=NULL WHERE copied_from_task_id=?', params: [a.task.id] }])).rejects.toThrow();
  expect(await fingerprint() === before).toBe(true);
});
it('A scope cannot unlink B copy provenance', async () => {
  const before = await fingerprint();
  await expect(db.batch([
    { sql: 'INSERT INTO _account_deletion_scope(user_id) VALUES (?)', params: [a.id] },
    { sql: 'UPDATE tasks SET copied_from_task_id=NULL WHERE copied_from_task_id=?', params: [b.task.id] },
  ])).rejects.toThrow();
  expect(await fingerprint() === before).toBe(true); await markersEmpty();
});
it('rolls back every business/auth deletion and marker on a late failure', async () => {
  db.sqlite.exec("CREATE TRIGGER synthetic_delete_failure BEFORE DELETE ON user BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
  const before = await fingerprint(); expect((await request(a.cookie)).status).toBe(500);
  expect(await fingerprint() === before).toBe(true); await markersEmpty();
  expect((await app.request(base + '/api/session', { headers: { Cookie: a.cookie } })).status).toBe(200);
});
it('a silently skipped account deletion also rolls back the whole batch', async () => {
  db.sqlite.exec('CREATE TRIGGER synthetic_skip_delete BEFORE DELETE ON user BEGIN SELECT RAISE(IGNORE); END;');
  const before = await fingerprint(); expect((await request(a.cookie)).status).toBe(500);
  expect(await fingerprint() === before).toBe(true); await markersEmpty();
});
it('displays C134 irreversible deletion, current-password confirmation and export advice', () => {
  const html = renderToStaticMarkup(createElement(AccountDeletionForm, { onDeleted: () => undefined }));
  expect(html).toContain('계정 자료가 함께 삭제'); expect(html).toContain('복구할 수 없습니다');
  expect(html).toContain('전체 JSON 다운로드'); expect(html).toContain('삭제 확인용 현재 비밀번호');
  expect(html).toContain('type="password"'); expect(html).not.toContain('삭제 기능을 지원하지 않습니다');
});
