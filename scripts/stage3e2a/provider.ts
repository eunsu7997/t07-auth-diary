import type { BoundStatement } from '../stage3d/adapters.ts';
import type { D1DatabaseLike, D1StatementLike } from '../stage3e1/d1-adapter.ts';
import { detectUnsupportedSql } from '../stage3e1/prepare-plan.ts';
import { enforceLimits } from '../stage3d/import-plan.ts';
import { normalizeTarget, targetMatches, transportKind, transportActive, requireDisposableApproval, type TargetPolicy, type CloudflareD1Transport } from './transport.ts';
import { observationQuery, observationIdForSql, projectObservationRows, type D1ObservationQuery } from './queries.ts';
const providers = new WeakSet<object>();
const sessions = new WeakMap<object, object>();
const fail = (code: string): never => { throw new Error(code); };
export type D1Failure = 'D1_RESULT_INVALID' | 'D1_OPERATION_FAILED';
// No raw D1 error/message/cause survives normalization: it may contain SQL or bound values.
export function normalizeD1Error(_error: unknown): Error { return new Error('D1_OPERATION_FAILED'); }
export function normalizeD1Result<T>(value: unknown): { success: true; results: T[] } {
  const v = value as { success?: unknown; results?: unknown } | undefined;
  if (!v || v.success !== true || !Array.isArray(v.results)) return fail('D1_RESULT_INVALID');
  return { success: true, results: v.results as T[] };
}
export function convertPlan(statements: readonly BoundStatement[]): readonly BoundStatement[] {
  if (!Array.isArray(statements) || statements.some(s => !s || typeof s.sql !== 'string' || !Array.isArray(s.params) || detectUnsupportedSql(s.sql) || s.params.some((v: unknown) => v !== null && typeof v !== 'string' && (typeof v !== 'number' || !Number.isFinite(v))))) fail('D1_STATEMENT_INVALID');
  enforceLimits(statements);
  return Object.freeze(statements.map(s => Object.freeze({ sql: s.sql, params: Object.freeze([...s.params]) })));
}
export class DisposableRemoteD1Provider {
  #state: 'CREATED' | 'CONNECTING' | 'CONNECTED' | 'CLOSED' = 'CREATED';
  #policy: TargetPolicy;
  #transport: CloudflareD1Transport;
  constructor(policy: TargetPolicy, transport: CloudflareD1Transport) {
    this.#policy = normalizeTarget(policy); this.#transport = transport;
    if (transportKind(transport) === 'UNKNOWN') fail('TRANSPORT_UNTRUSTED');
    providers.add(this); Object.freeze(this);
  }
  get transportOrigin() { return transportKind(this.#transport); }
  get state() { void this.connected; return this.#state; }
  get connected() {
    if (this.#state === 'CONNECTED' && !transportActive(this.#transport)) { this.#state = 'CLOSED'; sessions.delete(this); }
    return this.#state === 'CONNECTED';
  }
  async connect(approval?: unknown) {
    if (this.#state !== 'CREATED') fail('PROVIDER_STATE_INVALID');
    this.#state = 'CONNECTING'; // Before any await: only one connect may proceed.
    const session = Object.freeze({}); sessions.set(this, session);
    try {
      await this.#transport.connect(this.#policy, approval, { policy: this.#policy, session, action: 'CONNECT' });
      if (!targetMatches(this.#policy, await this.#transport.getInfo())) fail('OBSERVED_TARGET_MISMATCH');
      if (this.#state !== 'CONNECTING' || sessions.get(this) !== session) fail('PROVIDER_STATE_INVALID');
      this.#state = 'CONNECTED';
    } catch { await this.disconnect(); fail('PROVIDER_CONNECT_REJECTED'); }
  }
  async disconnect() { this.#state = 'CLOSED'; sessions.delete(this); await this.#transport.disconnect(); }
  async #ready() {
    if (!this.connected) fail('PROVIDER_NOT_CONNECTED');
    const session = sessions.get(this);
    let info;
    try { info = await this.#transport.getInfo(); } catch { await this.disconnect(); return fail('PROVIDER_NOT_CONNECTED'); }
    if (!targetMatches(this.#policy, info)) { await this.disconnect(); fail('OBSERVED_TARGET_MISMATCH'); }
    if (!this.connected || sessions.get(this) !== session) fail('PROVIDER_NOT_CONNECTED');
    return session!;
  }
  async info() { await this.#ready(); return this.#transport.getInfo(); }
  async writers() { await this.#ready(); return this.#transport.getWriters(); }
  async recovery() { await this.#ready(); return this.#transport.getRecovery(); }
  async bookmarkReadable() { await this.#ready(); const v = await this.#transport.getBookmark(); return typeof v === 'string' && v.length > 0; }
  async verification() { await this.#ready(); return this.#transport.getVerification(); }
  async readObservationQuery<T>(id: D1ObservationQuery, params: BoundStatement['params'] = []): Promise<T[]> {
    const session = await this.#ready(); const query = observationQuery(id, params);
    try {
      const rows = normalizeD1Result<unknown>(await this.#transport.query(query)).results;
      if (!this.connected || sessions.get(this) !== session) fail('PROVIDER_NOT_CONNECTED');
      return projectObservationRows<T>(rows, query.columns);
    } catch { throw normalizeD1Error(undefined); }
  }
  async #batch(statements: readonly BoundStatement[], approval?: unknown) {
    const session = await this.#ready(); const context = { policy: this.#policy, session, action: 'BATCH' as const };
    if (this.transportOrigin !== 'FAKE_TRANSPORT') requireDisposableApproval(approval, context);
    const converted = convertPlan(statements);
    try {
      const result = await this.#transport.batch(converted, approval, context);
      if (!this.connected || sessions.get(this) !== session) fail('PROVIDER_NOT_CONNECTED');
      if (!Array.isArray(result) || result.length !== converted.length) return fail('D1_RESULT_INVALID');
      // Import callers need success only. Never expose arbitrary batch SELECT/auth payloads.
      return result.map(v => { normalizeD1Result(v); return { success: true, results: [] }; });
    } catch { throw normalizeD1Error(undefined); }
  }
  async getDatabase(): Promise<D1DatabaseLike> {
    await this.#ready(); const provider = this; const statements = new WeakSet<object>();
    class Prepared implements D1StatementLike {
      constructor(readonly value: BoundStatement) { statements.add(this); Object.freeze(this); }
      bind(...values: (string | number | null)[]) { return new Prepared({ sql: this.value.sql, params: Object.freeze([...values]) }); }
      async all<T>() { await provider.#ready(); return { success: true, results: await provider.readObservationQuery<T>(observationIdForSql(this.value.sql), this.value.params) }; }
    }
    return { prepare: sql => new Prepared(Object.freeze({ sql, params: [] })), batch: async list => {
      if (list.some(s => !statements.has(s))) fail('D1_STATEMENT_FOREIGN');
      return provider.#batch(list.map(s => (s as Prepared).value));
    } };
  }
  async execute(plan: readonly BoundStatement[], approval?: unknown) {
    const session = await this.#ready();
    requireDisposableApproval(approval, { policy: this.#policy, session, action: 'BATCH' });
    return this.#batch(plan, approval); // The SAME opaque approval reaches the transport boundary.
  }
}
export function isProvider(value: DisposableRemoteD1Provider) { return providers.has(value) && Object.getPrototypeOf(value) === DisposableRemoteD1Provider.prototype; }
export function providerSession(value: DisposableRemoteD1Provider) { return isProvider(value) && value.connected ? sessions.get(value) : undefined; }
Object.freeze(DisposableRemoteD1Provider.prototype);
