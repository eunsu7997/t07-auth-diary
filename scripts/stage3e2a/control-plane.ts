import { normalizeTarget, type Identity, type TargetPolicy, type WriterFacts, type RecoveryFacts, type VerificationFacts } from './transport.ts';
import { httpOrigin, type ControlPlaneHttp } from './control-plane-http.ts';
export type ControlPlaneValue<T> = Readonly<{ state: 'UNKNOWN' }> | Readonly<{ state: 'Observed'; value: T; origin: 'FAKE_CONTROL_PLANE' | 'REMOTE_CONTROL_PLANE' }>;
export interface ControlPlaneObserver {
  observeAccount(): Promise<ControlPlaneValue<{ accountId: string }>>;
  observeDatabase(): Promise<ControlPlaneValue<Identity>>;
  observeDeploymentWriters(): Promise<ControlPlaneValue<WriterFacts>>;
  observeRecoveryPermissions(): Promise<ControlPlaneValue<RecoveryFacts>>;
  observeVerificationCapability?(): Promise<ControlPlaneValue<VerificationFacts>>;
}
const issued = new WeakSet<object>();
const fresh = new WeakMap<object, { at: number; accountId: string; databaseId: string }>();
const freeze = <T>(v: T): T => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
export class FakeControlPlaneObserver implements ControlPlaneObserver {
  #fixture: { identity?: Identity; writers?: WriterFacts; recovery?: RecoveryFacts };
  constructor(fixture: { identity?: Identity; writers?: WriterFacts; recovery?: RecoveryFacts }) { this.#fixture = structuredClone(fixture); Object.freeze(this); }
  #value<T>(v: T | undefined): ControlPlaneValue<T> {
    if (!v) return Object.freeze({ state: 'UNKNOWN' });
    const result = freeze({ state: 'Observed' as const, value: structuredClone(v), origin: 'FAKE_CONTROL_PLANE' as const }); issued.add(result); return result;
  }
  async observeAccount() { return this.#value(this.#fixture.identity ? { accountId: this.#fixture.identity.accountId } : undefined); }
  async observeDatabase() { return this.#value(this.#fixture.identity); }
  async observeDeploymentWriters() { return this.#value(this.#fixture.writers); }
  async observeRecoveryPermissions() { return this.#value(this.#fixture.recovery); }
}
export function readControlPlaneValue<T>(v: ControlPlaneValue<T>): T | undefined { return issued.has(v) && v.state === 'Observed' ? v.value : undefined; }
export function readRemoteControlPlaneValue<T>(v: ControlPlaneValue<T>): T | undefined {
  const at = fresh.get(v)?.at;
  return v.state === 'Observed' && v.origin === 'REMOTE_CONTROL_PLANE' && at !== undefined && Date.now() - at >= 0 && Date.now() - at <= 30000 ? readControlPlaneValue(v) : undefined;
}
export class CloudflareControlPlaneObserver implements ControlPlaneObserver {
  #http: ControlPlaneHttp; #policy: TargetPolicy;
  constructor(policy: TargetPolicy, http: ControlPlaneHttp) { this.#policy = normalizeTarget(policy); if (httpOrigin(http) === 'UNKNOWN') throw new Error('CONTROL_PLANE_HTTP_UNTRUSTED'); this.#http = http; Object.freeze(this); }
  async #observe<T>(operation: () => Promise<T>): Promise<ControlPlaneValue<T>> {
    try {
      const value = await operation(); const origin = httpOrigin(this.#http); if (origin === 'UNKNOWN') throw new Error('CONTROL_PLANE_HTTP_UNTRUSTED');
      const result = freeze({ state: 'Observed' as const, value, origin }); issued.add(result); fresh.set(result, { at: Date.now(), accountId: this.#policy.expectedAccountId, databaseId: this.#policy.expectedDatabaseId }); return result;
    } catch { return Object.freeze({ state: 'UNKNOWN' }); }
  }
  async #get(path: string) { const v = await this.#http.get('/client/v4' + path) as { success?: boolean; result?: unknown; result_info?: { page: number; total_pages: number } }; if (v?.success !== true || v.result === undefined) throw new Error('CONTROL_PLANE_READ_FAILED'); return v; }
  async #list(path: string) {
    const rows: Record<string, unknown>[] = [];
    for (let page = 1; page <= 20; page++) {
      const result = await this.#get(path + (path.includes('?') ? '&' : '?') + `page=${page}&per_page=100`);
      if (!Array.isArray(result.result) || !result.result_info || result.result_info.page !== page || !Number.isSafeInteger(result.result_info.total_pages) || result.result_info.total_pages < page) throw new Error('INVENTORY_INCOMPLETE');
      rows.push(...result.result); if (page === result.result_info.total_pages) return rows;
    }
    throw new Error('INVENTORY_INCOMPLETE');
  }
  observeAccount() { return this.#observe(async () => { const result = (await this.#get(`/accounts/${this.#policy.expectedAccountId}`)).result as { id?: string }; if (result.id !== this.#policy.expectedAccountId) throw new Error('ACCOUNT_MISMATCH'); return { accountId: result.id }; }); }
  observeDatabase() { return this.#observe(async () => {
    const p = this.#policy; const result = (await this.#get(`/accounts/${p.expectedAccountId}/d1/database/${p.expectedDatabaseId}`)).result as { uuid?: string; name?: string };
    if (result.uuid !== p.expectedDatabaseId || result.name !== p.expectedName) throw new Error('DATABASE_MISMATCH');
    return { accountId: p.expectedAccountId, databaseId: result.uuid, name: result.name, purpose: 'DISPOSABLE_TEST' as const };
  }); }
  observeDeploymentWriters() { return this.#observe(async () => {
    const p = this.#policy, base = `/accounts/${p.expectedAccountId}/workers/scripts`; const workers = await this.#list(base); const bound = new Set<string>();
    let workerDeployment = false, scheduledWriters = false;
    for (const worker of workers) {
      const name = worker.id; if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('WORKER_INVENTORY_INVALID');
      const settings = (await this.#get(`${base}/${name}/settings`)).result as { bindings?: { type: string; id?: string }[] };
      if (!Array.isArray(settings.bindings)) throw new Error('BINDINGS_UNKNOWN');
      if (!settings.bindings.some(b => b.type === 'd1' && b.id === p.expectedDatabaseId)) continue;
      bound.add(name); const deployments = (await this.#get(`${base}/${name}/deployments`)).result as { deployments?: unknown[] }; const schedules = (await this.#get(`${base}/${name}/schedules`)).result as { schedules?: unknown[] };
      if (!Array.isArray(deployments.deployments) || !Array.isArray(schedules.schedules)) throw new Error('WRITER_STATE_UNKNOWN');
      workerDeployment ||= deployments.deployments.length > 0; scheduledWriters ||= schedules.schedules.length > 0;
    }
    let routes = false;
    for (const zone of await this.#list(`/zones?account.id=${p.expectedAccountId}`)) {
      if (typeof zone.id !== 'string' || !/^[a-f0-9]{32}$/.test(zone.id) || (zone.account as { id?: string })?.id !== p.expectedAccountId) throw new Error('ZONE_ACCOUNT_UNKNOWN');
      for (const route of await this.#list(`/zones/${zone.id}/workers/routes`)) { if (typeof route.script !== 'string') throw new Error('ROUTE_UNKNOWN'); routes ||= bound.has(route.script); }
    }
    // Inventory cannot prove absence of dispatch namespaces/other control-plane writers.
    return { workerDeployment, routes, scheduledWriters, otherBindings: bound.size > 0 ? true : 'UNKNOWN' as const };
  }); }
  observeRecoveryPermissions() { return this.#observe(async () => {
    const p = this.#policy; const bookmark = (await this.#get(`/accounts/${p.expectedAccountId}/d1/database/${p.expectedDatabaseId}/time_travel/bookmark`)).result as { bookmark?: string };
    if (typeof bookmark.bookmark !== 'string' || !bookmark.bookmark) throw new Error('BOOKMARK_UNKNOWN');
    let restorePermission: boolean | 'UNKNOWN' = 'UNKNOWN';
    try {
      const verified = (await this.#get(`/accounts/${p.expectedAccountId}/tokens/verify`)).result as { id?: string; status?: string };
      if (!/^[a-f0-9]{32}$/.test(verified.id ?? '') || verified.status !== 'active') throw new Error('TOKEN_POLICY_UNKNOWN');
      const details = (await this.#get(`/accounts/${p.expectedAccountId}/tokens/${verified.id}`)).result as { id?: string; policies?: { effect?: string; resources?: Record<string, unknown>; permission_groups?: { name?: string }[]; condition?: unknown }[] };
      if (details.id !== verified.id || !Array.isArray(details.policies) || details.policies.some(v => v.effect !== 'allow' || v.condition !== undefined)) throw new Error('TOKEN_POLICY_UNKNOWN');
      restorePermission = details.policies.some(v => (v.resources?.[`com.cloudflare.api.account.${p.expectedAccountId}`] === '*' || v.resources?.['com.cloudflare.api.account.*'] === '*') && v.permission_groups?.some(g => g.name === 'D1 Write'));
    } catch { /* Policy visibility unavailable: UNKNOWN, not permission success. */ }
    // Bookmark alone does not expose the effective retention period. Never restore as a probe.
    return { timeTravelAvailable: true, bookmarkReadable: true, retentionDays: 'UNKNOWN' as const, restorePermission };
  }); }
  observeVerificationCapability() { return this.#observe(async () => { const identity = await this.observeDatabase(); if (!readControlPlaneValue(identity)) throw new Error('READ_UNKNOWN'); return { read: true, review: 'UNKNOWN' as const, export: 'UNKNOWN' as const, attackTests: 'UNKNOWN' as const }; }); }
}
export async function controlPlanePrecheck(observer: ControlPlaneObserver | undefined, policy: TargetPolicy) {
  if (!observer) return false;
  const facts = [await observer.observeAccount(), await observer.observeDatabase(), await observer.observeDeploymentWriters(), await observer.observeRecoveryPermissions(), await observer.observeVerificationCapability?.()];
  if (!facts.every(v => v && v.state === 'Observed' && v.origin === 'REMOTE_CONTROL_PLANE' && issued.has(v) && fresh.get(v)?.accountId === policy.expectedAccountId && fresh.get(v)?.databaseId === policy.expectedDatabaseId && Date.now() - fresh.get(v)!.at >= 0 && Date.now() - fresh.get(v)!.at <= 30000)) return false;
  const account = facts[0] as Extract<ControlPlaneValue<{ accountId: string }>, { state: 'Observed' }>;
  const db = facts[1] as Extract<ControlPlaneValue<Identity>, { state: 'Observed' }>;
  const writers = facts[2] as Extract<ControlPlaneValue<WriterFacts>, { state: 'Observed' }>;
  const recovery = facts[3] as Extract<ControlPlaneValue<RecoveryFacts>, { state: 'Observed' }>;
  const verification = facts[4] as Extract<ControlPlaneValue<VerificationFacts>, { state: 'Observed' }>;
  return account.value.accountId === policy.expectedAccountId && db.value.databaseId === policy.expectedDatabaseId && db.value.accountId === policy.expectedAccountId && db.value.name === policy.expectedName && !policy.deniedDatabaseIds.includes(db.value.databaseId) && [writers.value.workerDeployment, writers.value.routes, writers.value.scheduledWriters, writers.value.otherBindings].every(v => v === false) && recovery.value.timeTravelAvailable === true && recovery.value.bookmarkReadable === true && typeof recovery.value.retentionDays === 'number' && recovery.value.retentionDays >= 7 && recovery.value.restorePermission === true && Object.values(verification.value).every(v => v === true);
}
Object.freeze(FakeControlPlaneObserver.prototype);
Object.freeze(CloudflareControlPlaneObserver.prototype);
