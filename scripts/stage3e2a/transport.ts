// Offline preparation only. Import and construction perform no network I/O.
import { readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import type { BoundStatement } from '../stage3d/adapters.ts';
import type { D1DatabaseLike } from '../stage3e1/d1-adapter.ts';
import { controlPlanePrecheck, readRemoteControlPlaneValue, type ControlPlaneObserver } from './control-plane.ts';
import { requireDisposableApproval } from './approval.ts';
export { requireDisposableApproval } from './approval.ts';
export type Purpose = 'DISPOSABLE_TEST' | 'PRODUCTION_T07';
export type TargetPolicy = Readonly<{ purpose: Purpose; expectedDatabaseId: string; expectedAccountId: string; expectedName: string; deniedDatabaseIds: readonly string[]; explicitConfirmation: boolean }>;
export type Identity = { accountId: string; databaseId: string; name: string; purpose: Purpose };
export type WriterFacts = { workerDeployment: boolean | 'UNKNOWN'; routes: boolean | 'UNKNOWN'; scheduledWriters: boolean | 'UNKNOWN'; otherBindings: boolean | 'UNKNOWN' };
export type RecoveryFacts = { timeTravelAvailable: boolean | 'UNKNOWN'; retentionDays: number | 'UNKNOWN'; bookmarkReadable: boolean | 'UNKNOWN'; restorePermission: boolean | 'UNKNOWN' };
export type VerificationFacts = { read: boolean | 'UNKNOWN'; review: boolean | 'UNKNOWN'; export: boolean | 'UNKNOWN'; attackTests: boolean | 'UNKNOWN' };
export interface CloudflareD1Transport {
  connect(policy: TargetPolicy, approval?: unknown, context?: ApprovalContext): Promise<void>;
  disconnect(): Promise<void>;
  getInfo(): Promise<Identity | undefined>;
  query(statement: BoundStatement): Promise<unknown>;
  batch(statements: readonly BoundStatement[], approval?: unknown, context?: ApprovalContext): Promise<unknown>;
  getWriters(): Promise<WriterFacts>;
  getRecovery(): Promise<RecoveryFacts>;
  getBookmark(): Promise<string | undefined>;
  getVerification(): Promise<VerificationFacts>;
}
const fail = (code: string): never => { throw new Error(code); };
const dbId = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim()) ? v.trim().toLowerCase() : undefined;
const accountId = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{32}$/i.test(v.trim()) ? v.trim().toLowerCase() : undefined;
export function normalizeTarget(policy: TargetPolicy): TargetPolicy {
  if (policy.purpose !== 'DISPOSABLE_TEST' || policy.explicitConfirmation !== true) fail('DISPOSABLE_TARGET_REQUIRED');
  const database = dbId(policy.expectedDatabaseId); const account = accountId(policy.expectedAccountId);
  if (!database || !account || !/^aleph-t07-disposable-[a-z0-9-]+$/.test(policy.expectedName)) return fail('TARGET_INVALID');
  if (!Array.isArray(policy.deniedDatabaseIds) || !policy.deniedDatabaseIds.length) fail('DENYLIST_REQUIRED');
  const protectedIds = productionBindingIds();
  const denied = [...policy.deniedDatabaseIds.map(dbId), ...protectedIds];
  if (denied.some(v => !v) || denied.includes(database)) fail('TARGET_DENIED');
  return Object.freeze({ ...policy, expectedDatabaseId: database, expectedAccountId: account, deniedDatabaseIds: Object.freeze(denied as string[]) });
}
function productionBindingIds() {
  try {
    return ['../../wrangler.jsonc', '../../../t06/wrangler.jsonc'].flatMap(relative => {
      const text = readFileSync(new URL(relative, import.meta.url), 'utf8');
      const ids = [...text.matchAll(/"database_id"\s*:\s*"([^"]+)"/g)].map(m => dbId(m[1]));
      if (!ids.length || ids.some(v => !v)) return fail('PRODUCTION_PROTECTION_UNKNOWN');
      return ids as string[];
    });
  } catch { return fail('PRODUCTION_PROTECTION_UNKNOWN'); }
}
export function targetMatches(policy: TargetPolicy, observed: Identity | undefined) {
  // Policy + exact identity/account/naming/denylist derive purpose; self-report is only a conservative veto.
  return policy.purpose === 'DISPOSABLE_TEST' && /^aleph-t07-disposable-[a-z0-9-]+$/.test(policy.expectedName) && !!observed && observed.purpose !== 'PRODUCTION_T07' && dbId(observed.databaseId) === policy.expectedDatabaseId && accountId(observed.accountId) === policy.expectedAccountId && observed.name === policy.expectedName && !policy.deniedDatabaseIds.includes(dbId(observed.databaseId)!);
}
export type ApprovalContext = Readonly<{ policy: TargetPolicy; session: object; action: 'CONNECT' | 'BATCH'; transportOrigin?: 'REMOTE_TRANSPORT' | 'FAKE_TRANSPORT' }>;
export type DisposableExecutionApproval = Readonly<{ kind: 'DisposableExecutionApproval'; expiresAt: number; action: 'CONNECT' | 'BATCH' }>;
const fakeInstances = new WeakSet<object>(); const realInstances = new WeakSet<object>();
export function transportKind(value: CloudflareD1Transport): 'FAKE_TRANSPORT' | 'REMOTE_TRANSPORT' | 'UNKNOWN' {
  if (fakeInstances.has(value) && Object.getPrototypeOf(value) === FakeCloudflareD1Transport.prototype) return 'FAKE_TRANSPORT';
  if (realInstances.has(value) && Object.getPrototypeOf(value) === WranglerDisposableTransport.prototype) return 'REMOTE_TRANSPORT';
  return 'UNKNOWN';
}
export function transportActive(value: CloudflareD1Transport) {
  const kind = transportKind(value);
  return kind === 'FAKE_TRANSPORT' ? (value as FakeCloudflareD1Transport).active : kind === 'REMOTE_TRANSPORT' ? (value as WranglerDisposableTransport).active : false;
}
export class FakeCloudflareD1Transport implements CloudflareD1Transport {
  #connected = false;
  #fixture: { identity?: Identity; writers: WriterFacts; recovery: RecoveryFacts; verification: VerificationFacts; bookmark?: string };
  #query: (s: BoundStatement) => Promise<unknown>;
  #batch: (s: readonly BoundStatement[]) => Promise<unknown>;
  constructor(fixture: FakeTransportFixture, actions: { query(s: BoundStatement): Promise<unknown>; batch(s: readonly BoundStatement[]): Promise<unknown> }) {
    this.#fixture = structuredClone(fixture); this.#query = actions.query; this.#batch = actions.batch; fakeInstances.add(this); Object.freeze(this);
  }
  async connect(_policy: TargetPolicy) { this.#connected = true; }
  get active() { return this.#connected; }
  async disconnect() { this.#connected = false; }
  #ready() { if (!this.#connected) fail('TRANSPORT_NOT_CONNECTED'); }
  async getInfo() { this.#ready(); return structuredClone(this.#fixture.identity); }
  async query(s: BoundStatement) { this.#ready(); return this.#query(s); }
  async batch(s: readonly BoundStatement[], approval?: unknown, context?: ApprovalContext) { this.#ready(); if (approval !== undefined) requireDisposableApproval(approval, context ? { ...context, transportOrigin: 'FAKE_TRANSPORT' } : undefined, true); return this.#batch(s); }
  async getWriters() { this.#ready(); return structuredClone(this.#fixture.writers); }
  async getRecovery() { this.#ready(); return structuredClone(this.#fixture.recovery); }
  async getBookmark() { this.#ready(); return this.#fixture.bookmark; }
  async getVerification() { this.#ready(); return structuredClone(this.#fixture.verification); }
}
export type FakeTransportFixture = { identity?: Identity; writers: WriterFacts; recovery: RecoveryFacts; verification: VerificationFacts; bookmark?: string };
export class WranglerDisposableTransport implements CloudflareD1Transport {
  #proxy?: { env: { DISPOSABLE_DB: D1DatabaseLike }; dispose(): Promise<void> };
  #policy?: TargetPolicy;
  #session?: object;
  #configPath: string;
  #controlPlane?: ControlPlaneObserver;
  constructor(configPath: string, controlPlane?: ControlPlaneObserver) { this.#configPath = configPath; this.#controlPlane = controlPlane; realInstances.add(this); Object.freeze(this); }
  get active() { return this.#proxy !== undefined; }
  async connect(input: TargetPolicy, approval?: unknown, context?: ApprovalContext) {
    if (!await controlPlanePrecheck(this.#controlPlane, input)) return fail('CONTROL_PLANE_UNKNOWN');
    const policy = normalizeTarget(input);
    if (!context || context.action !== 'CONNECT' || context.policy.expectedDatabaseId !== policy.expectedDatabaseId || context.policy.expectedAccountId !== policy.expectedAccountId || context.policy.expectedName !== policy.expectedName) return fail('DISPOSABLE_REMOTE_TEST_NOT_APPROVED');
    context = { ...context, transportOrigin: 'REMOTE_TRANSPORT' }; requireDisposableApproval(approval, context);
    // Unreachable in Stage3E-2A. Never fall back to the application's Wrangler file or production binding.
    const path = resolve(this.#configPath);
    if (basename(path) !== 'disposable-proxy.json') fail('ISOLATED_PROXY_CONFIG_REQUIRED');
    let config: Record<string, unknown>;
    try { config = JSON.parse(readFileSync(path, 'utf8')); } catch { return fail('PROXY_CONFIG_INVALID'); }
    if (Object.keys(config).some(k => !['name', 'account_id', 'compatibility_date', 'd1_databases'].includes(k))) fail('PROXY_CONFIG_INVALID');
    const bindings = config.d1_databases as { binding: string; database_id: string; database_name: string; remote: boolean }[];
    if (config.name !== policy.expectedName || config.account_id !== policy.expectedAccountId || !Array.isArray(bindings) || bindings.length !== 1 || bindings[0].binding !== 'DISPOSABLE_DB' || bindings[0].database_id !== policy.expectedDatabaseId || bindings[0].database_name !== policy.expectedName || bindings[0].remote !== true) fail('PROXY_CONFIG_TARGET_MISMATCH');
    const { getPlatformProxy } = await import('wrangler');
    requireDisposableApproval(approval, context, true);
    this.#proxy = await getPlatformProxy<{ DISPOSABLE_DB: D1DatabaseLike }>({ configPath: path, envFiles: [], persist: false, remoteBindings: true });
    this.#policy = policy;
    this.#session = context.session;
  }
  async disconnect() { const proxy = this.#proxy; this.#proxy = undefined; this.#policy = undefined; this.#session = undefined; if (proxy) await proxy.dispose(); }
  #database() { return this.#proxy?.env.DISPOSABLE_DB ?? fail('TRANSPORT_NOT_CONNECTED'); }
  async query(s: BoundStatement) { return this.#database().prepare(s.sql).bind(...s.params).all(); }
  async batch(s: readonly BoundStatement[], approval?: unknown, context?: ApprovalContext) {
    if (!this.#policy || !context || context.action !== 'BATCH' || context.session !== this.#session || context.policy.expectedDatabaseId !== this.#policy.expectedDatabaseId || context.policy.expectedAccountId !== this.#policy.expectedAccountId) return fail('DISPOSABLE_REMOTE_TEST_NOT_APPROVED');
    requireDisposableApproval(approval, { ...context, transportOrigin: 'REMOTE_TRANSPORT' }, true); return this.#database().batch(s.map(v => this.#database().prepare(v.sql).bind(...v.params)));
  }
  async getInfo(): Promise<Identity | undefined> { return this.#policy && this.#controlPlane ? readRemoteControlPlaneValue(await this.#controlPlane.observeDatabase()) : undefined; }
  async getWriters(): Promise<WriterFacts> { return this.#policy && this.#controlPlane ? readRemoteControlPlaneValue(await this.#controlPlane.observeDeploymentWriters()) ?? { workerDeployment: 'UNKNOWN', routes: 'UNKNOWN', scheduledWriters: 'UNKNOWN', otherBindings: 'UNKNOWN' } : { workerDeployment: 'UNKNOWN', routes: 'UNKNOWN', scheduledWriters: 'UNKNOWN', otherBindings: 'UNKNOWN' }; }
  async getRecovery(): Promise<RecoveryFacts> { return this.#policy && this.#controlPlane ? readRemoteControlPlaneValue(await this.#controlPlane.observeRecoveryPermissions()) ?? { timeTravelAvailable: 'UNKNOWN', retentionDays: 'UNKNOWN', bookmarkReadable: 'UNKNOWN', restorePermission: 'UNKNOWN' } : { timeTravelAvailable: 'UNKNOWN', retentionDays: 'UNKNOWN', bookmarkReadable: 'UNKNOWN', restorePermission: 'UNKNOWN' }; }
  async getBookmark(): Promise<string | undefined> { return (await this.getRecovery()).bookmarkReadable === true ? 'observed-readable' : undefined; }
  async getVerification(): Promise<VerificationFacts> { return this.#policy && this.#controlPlane?.observeVerificationCapability ? readRemoteControlPlaneValue(await this.#controlPlane.observeVerificationCapability()) ?? { read: 'UNKNOWN', review: 'UNKNOWN', export: 'UNKNOWN', attackTests: 'UNKNOWN' } : { read: 'UNKNOWN', review: 'UNKNOWN', export: 'UNKNOWN', attackTests: 'UNKNOWN' }; }
}
Object.freeze(FakeCloudflareD1Transport.prototype);
Object.freeze(WranglerDisposableTransport.prototype);
