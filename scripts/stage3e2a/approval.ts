import { normalizeTarget, type ApprovalContext, type DisposableExecutionApproval } from './transport.ts';
import { controlPlanePrecheck, type ControlPlaneObserver } from './control-plane.ts';
const sessions = new WeakMap<object, { origin: 'REMOTE_TRANSPORT' | 'FAKE_TRANSPORT'; active: boolean }>();
const approvals = new WeakMap<object, { databaseId: string; accountId: string; name: string; session: object; expiresAt: number; action: 'CONNECT' | 'BATCH'; used: boolean; origin: 'REMOTE_TRANSPORT' | 'FAKE_TRANSPORT' }>();
const denied = (): never => { throw new Error('DISPOSABLE_REMOTE_TEST_NOT_APPROVED'); };
export function createApprovalSession(origin: 'REMOTE_TRANSPORT' | 'FAKE_TRANSPORT') { const session = Object.freeze({}); sessions.set(session, { origin, active: true }); return session; }
export function closeApprovalSession(session: object | undefined) { if (session) sessions.delete(session); }
function issue(context: ApprovalContext, ttlMs: number, origin: 'REMOTE_TRANSPORT' | 'FAKE_TRANSPORT'): DisposableExecutionApproval {
  const policy = normalizeTarget(context.policy); const session = sessions.get(context.session);
  if (!session?.active || session.origin !== origin || context.transportOrigin !== origin || !['CONNECT', 'BATCH'].includes(context.action) || !Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 30000) return denied();
  const expiresAt = Date.now() + ttlMs; const result = Object.freeze({ kind: 'DisposableExecutionApproval' as const, expiresAt, action: context.action });
  approvals.set(result, { databaseId: policy.expectedDatabaseId, accountId: policy.expectedAccountId, name: policy.expectedName, session: context.session, expiresAt, action: context.action, used: false, origin }); return result;
}
// The only production mint path requires fresh, privately issued actual control-plane facts.
export class DisposableApprovalAuthority {
  #observer: ControlPlaneObserver;
  constructor(observer: ControlPlaneObserver) { this.#observer = observer; Object.freeze(this); }
  async authorize(context: ApprovalContext, ttlMs = 30000) {
    const policy = normalizeTarget(context.policy);
    const snapshot = Object.freeze({ policy, session: context.session, action: context.action, transportOrigin: context.transportOrigin });
    if (snapshot.transportOrigin !== 'REMOTE_TRANSPORT' || !await controlPlanePrecheck(this.#observer, policy)) return denied();
    return issue(snapshot, ttlMs, 'REMOTE_TRANSPORT');
  }
}
// Same private mint/validation logic, but its products can NEVER authorize a real transport.
export function issueFixtureApproval(context: ApprovalContext, ttlMs = 30000) { return issue(context, ttlMs, 'FAKE_TRANSPORT'); }
export function requireDisposableApproval(value: unknown, context?: ApprovalContext, consume = false) {
  const record = value && typeof value === 'object' ? approvals.get(value) : undefined;
  if (!record || !context || !context.policy || !Array.isArray(context.policy.deniedDatabaseIds) || !context.policy.deniedDatabaseIds.length || context.policy.explicitConfirmation !== true || !Object.isFrozen(value) || record.used || record.expiresAt <= Date.now() || !sessions.has(record.session) || record.session !== context.session || record.databaseId !== context.policy.expectedDatabaseId || record.accountId !== context.policy.expectedAccountId || record.name !== context.policy.expectedName || record.action !== context.action || record.origin !== context.transportOrigin || context.policy.purpose !== 'DISPOSABLE_TEST' || context.policy.deniedDatabaseIds.includes(record.databaseId)) return denied();
  if (consume) record.used = true; // Atomic synchronous consumption BEFORE I/O, including failure/unknown outcome.
}
Object.freeze(DisposableApprovalAuthority.prototype);
