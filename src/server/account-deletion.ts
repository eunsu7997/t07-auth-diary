import type { Database, Statement } from './db.ts';
import type { Auth } from './auth.ts';
import { getIP } from '@better-auth/core/utils/ip';

// Reuse Better Auth 1.7.7's database rateLimit model and atomic incrementOne
// primitive, with the same lastRequest-based 60-second window as its limiter.
// Namespaced, hashed user+trusted-IP keys never share login/signup counters.
export async function consumeAccountDeletionAttempt(auth: Auth, userId: string, request: Request) {
  const context = await auth.$context;
  const ip = getIP(request, context.options) ?? 'no-trusted-ip';
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([userId, ip])));
  const key = 'account-delete:' + Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  const adapter = context.adapter;
  const read = async () => (await adapter.findMany<{ count: number; lastRequest: number | bigint }>({ model: 'rateLimit', where: [{ field: 'key', value: key }] }))[0];
  for (let attempt = 0; attempt < 16; attempt++) {
    const row = await read();
    const now = Date.now();
    if (!row) {
      try {
        await adapter.create({ model: 'rateLimit', data: { key, count: 1, lastRequest: now } });
        return { allowed: true, retryAfter: 0 };
      } catch (error) { if (!await read()) throw error; continue; }
    }
    const lastRequest = Number(row.lastRequest);
    if (now - lastRequest >= 60_000) {
      if (await adapter.incrementOne({ model: 'rateLimit', where: [
        { field: 'key', value: key }, { field: 'lastRequest', operator: 'lte', value: lastRequest },
      ], increment: {}, set: { count: 1, lastRequest: now } })) return { allowed: true, retryAfter: 0 };
      continue;
    }
    if (await adapter.incrementOne({ model: 'rateLimit', where: [
      { field: 'key', value: key }, { field: 'lastRequest', operator: 'gt', value: now - 60_000 },
      { field: 'count', operator: 'lt', value: 5 },
    ], increment: { count: 1 }, set: { lastRequest: now } })) return { allowed: true, retryAfter: 0 };
    const fresh = await read();
    if (!fresh || now - Number(fresh.lastRequest) >= 60_000) continue;
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((Number(fresh.lastRequest) + 60_000 - now) / 1000)) };
  }
  throw new Error('Account deletion rate counter unavailable'); // Fail closed.
}

// A single Database.batch is transactional in both LocalDatabase and D1Adapter.
// The password hash and live session are rechecked inside it to close the gap
// between password verification and deletion. Neither value is logged/exported.
export async function deleteOwnedAccount(db: Database, userId: string, sessionId: string, credentialHash: string) {
  const taskScope = 'plan_id IN (SELECT id FROM plans WHERE owner_user_id=?)';
  const statements: Statement[] = [{
    sql: `INSERT INTO _account_deletion_scope(user_id) VALUES ((SELECT u.id FROM user u
      JOIN account a ON a.userId=u.id AND a.providerId='credential'
      JOIN session s ON s.userId=u.id
      WHERE u.id=? AND a.password=? AND s.id=? AND
      COALESCE(julianday(s.expiresAt), julianday(s.expiresAt/1000.0, 'unixepoch')) > julianday(?)))`,
    params: [userId, credentialHash, sessionId, new Date().toISOString()],
  }];
  const owned = (sql: string) => statements.push({ sql, params: [userId] });
  owned(`DELETE FROM task_tags WHERE task_id IN (SELECT id FROM tasks WHERE ${taskScope})`);
  owned(`DELETE FROM execution_logs WHERE task_id IN (SELECT id FROM tasks WHERE ${taskScope})`);
  owned(`UPDATE tasks SET copied_from_task_id=NULL WHERE ${taskScope} AND copied_from_task_id IS NOT NULL`);
  owned(`DELETE FROM tasks WHERE ${taskScope}`);
  owned('DELETE FROM plan_versions WHERE plan_id IN (SELECT id FROM plans WHERE owner_user_id=?)');
  owned('DELETE FROM plans WHERE owner_user_id=?');
  owned('DELETE FROM tags WHERE owner_user_id=?');
  // Installed Better Auth 1.7.7 reset-password verifications store user.id as value.
  // Email verification is a stateless signed token; rateLimit is shared IP metadata,
  // not user-owned data, and is deliberately not deleted for other users.
  owned("DELETE FROM verification WHERE value=? AND identifier LIKE 'reset-password:%'");
  owned('DELETE FROM session WHERE userId=?');
  owned('DELETE FROM account WHERE userId=?');
  owned('DELETE FROM user WHERE id=?'); // Cascades the scope marker away.
  // A skipped user DELETE is also failure: NOT NULL aborts the same batch if
  // the user still exists, rather than committing partial business deletion.
  owned('INSERT INTO _account_deletion_scope(user_id) SELECT NULL WHERE EXISTS(SELECT 1 FROM user WHERE id=?)');
  await db.batch(statements);
}
