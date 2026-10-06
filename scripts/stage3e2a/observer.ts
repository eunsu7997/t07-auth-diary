import type { Owner, SchemaRow } from '../stage3d/adapters.ts';
import { APPROVED_MIGRATIONS } from '../stage3d/adapters.ts';
import { tables } from '../stage3d/source.ts';
import { digest } from '../stage3d/source.ts';
import { schemaFingerprint } from '../stage3e1/d1-adapter.ts';
import { captureRateBaseline, checkRateBaseline, type RateRow, type RateBaseline } from '../stage3e1/safety.ts';
import { DisposableRemoteD1Provider, isProvider, providerSession } from './provider.ts';
import type { Identity, WriterFacts, RecoveryFacts, VerificationFacts } from './transport.ts';
export type Observation<T> = Readonly<{ provenance: 'UNKNOWN'; state: 'UNKNOWN' }> | Readonly<{ provenance: 'FAKE_TEST' | 'REMOTE_OBSERVED'; state: 'PASS' | 'FAIL' | 'UNKNOWN'; value: T; observedAt: number }>;
const issued = new WeakMap<object, { provider: DisposableRemoteD1Provider; session: object }>();
const logoutBaselines = new WeakMap<object, { session: object; ownerFingerprint: string; baseline: RateBaseline }>();
const unknown = <T>(): Observation<T> => Object.freeze({ provenance: 'UNKNOWN', state: 'UNKNOWN' });
const freeze = <T>(v: T): T => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
function issue<T>(provider: DisposableRemoteD1Provider, session: object, value: T, state: 'PASS' | 'FAIL' | 'UNKNOWN'): Observation<T> {
  if (providerSession(provider) !== session || provider.transportOrigin === 'UNKNOWN') return unknown();
  const result = freeze({ provenance: provider.transportOrigin === 'REMOTE_TRANSPORT' ? 'REMOTE_OBSERVED' as const : 'FAKE_TEST' as const, state, value, observedAt: Date.now() });
  issued.set(result, { provider, session }); return result;
}
export function readObservation<T>(value: Observation<T>): T | undefined {
  const record = issued.get(value);
  return record && providerSession(record.provider) === record.session && 'value' in value ? value.value : undefined;
}
export function testOnlyPass(value: Observation<unknown>) { return !!readObservation(value) && value.provenance === 'FAKE_TEST' && value.state === 'PASS'; }
export function remoteEligible(value: Observation<unknown>) { return !!readObservation(value) && value.provenance === 'REMOTE_OBSERVED' && value.state === 'PASS'; }
export type ExternalWriterObservation = WriterFacts & { activeSessions: number };
export type RecoveryObservation = RecoveryFacts;
export class DisposableRemoteObserver {
  #provider: DisposableRemoteD1Provider;
  constructor(provider: DisposableRemoteD1Provider) { if (!isProvider(provider)) throw new Error('PROVIDER_UNTRUSTED'); this.#provider = provider; }
  async #observe<T>(operation: () => Promise<{ value: T; state: 'PASS' | 'FAIL' | 'UNKNOWN' }>): Promise<Observation<T>> {
    const session = providerSession(this.#provider); if (!session) return unknown();
    try { const result = await operation(); return issue(this.#provider, session, result.value, result.state); } catch { return unknown(); }
  }
  identity(): Promise<Observation<Identity>> { return this.#observe(async () => { const value = await this.#provider.info(); if (!value) throw new Error('IDENTITY_UNKNOWN'); return { value, state: 'PASS' }; }); }
  schema(expectedSchemaFingerprint: string, expectedTriggerFingerprint: string) {
    return this.#observe(async () => {
      const schema: SchemaRow[] = [];
      for (const id of ['TABLES', 'INDEXES', 'TRIGGERS'] as const) schema.push(...await this.#provider.readObservationQuery<SchemaRow>(id));
      const migrations = (await this.#provider.readObservationQuery<{ name: string }>('MIGRATIONS')).map(v => v.name);
      const counts: Record<string, number> = {}; const foreignKeys: Record<string, unknown[]> = {};
      for (const t of [...tables, 'user', 'account', 'session', 'verification', 'rateLimit']) {
        counts[t] = (await this.#provider.readObservationQuery<{ n: number }>(`COUNT_${t}`))[0]?.n;
        foreignKeys[t] = await this.#provider.readObservationQuery(`FK_LIST_${t}`);
      }
      const fkEnabled = (await this.#provider.readObservationQuery<{ foreign_keys: number }>('FK_ENABLED'))[0]?.foreign_keys === 1;
      const fkClean = (await this.#provider.readObservationQuery('FK_CHECK')).length === 0;
      const sf = schemaFingerprint(schema); const tf = schemaFingerprint(schema, true); const triggerCount = schema.filter(r => r.type === 'trigger').length;
      const value = { migrations, schemaFingerprint: sf, triggerFingerprint: tf, triggerCount, counts, foreignKeys, fkEnabled, fkClean };
      const valid = sf === expectedSchemaFingerprint && tf === expectedTriggerFingerprint && triggerCount === 17 && fkEnabled && fkClean && JSON.stringify(migrations) === JSON.stringify(Object.keys(APPROVED_MIGRATIONS)) && Object.values(counts).every(n => Number.isSafeInteger(n) && n >= 0);
      return { value, state: valid ? 'PASS' : 'FAIL' };
    });
  }
  writers(): Promise<Observation<ExternalWriterObservation>> {
    return this.#observe(async () => {
      const facts = await this.#provider.writers(); const activeSessions = (await this.#provider.readObservationQuery<{ n: number }>('SESSION_COUNT'))[0]?.n;
      const value = { ...facts, activeSessions };
      const writerValues = [facts.workerDeployment, facts.routes, facts.scheduledWriters, facts.otherBindings];
      const known = writerValues.every(v => typeof v === 'boolean') && Number.isSafeInteger(activeSessions) && activeSessions >= 0;
      return { value, state: !known ? 'UNKNOWN' : writerValues.every(v => v === false) && activeSessions === 0 ? 'PASS' : 'FAIL' };
    });
  }
  recovery(): Promise<Observation<RecoveryObservation>> {
    return this.#observe(async () => {
      const value = await this.#provider.recovery();
      const known = [value.timeTravelAvailable, value.bookmarkReadable, value.restorePermission].every(v => typeof v === 'boolean') && typeof value.retentionDays === 'number' && Number.isSafeInteger(value.retentionDays);
      const readable = known && value.bookmarkReadable === true ? await this.#provider.bookmarkReadable() : false;
      return { value, state: !known ? 'UNKNOWN' : value.timeTravelAvailable === true && value.restorePermission === true && value.bookmarkReadable === true && readable && (value.retentionDays as number) >= 7 ? 'PASS' : 'FAIL' };
    });
  }
  verification(): Promise<Observation<VerificationFacts>> {
    return this.#observe(async () => {
      const value = await this.#provider.verification();
      const capabilities = [value.read, value.review, value.export, value.attackTests];
      return { value, state: capabilities.some(v => typeof v !== 'boolean') ? 'UNKNOWN' : capabilities.every(v => v === true) ? 'PASS' : 'FAIL' };
    });
  }
  proxy() { return this.#observe(async () => { const result = await this.#provider.readObservationQuery<{ proxy_ok: number }>('PROXY'); return { value: { connected: result.length === 1 && result[0].proxy_ok === 1 }, state: result.length === 1 && result[0].proxy_ok === 1 ? 'PASS' : 'FAIL' }; }); }
  async #ownerState(expected: Owner) {
    const summary = (await this.#provider.readObservationQuery<{ userCount: number; accountCount: number; ownerMatches: number; accountMatches: number }>('AUTH_OWNER_SUMMARY', [expected.id, expected.email, expected.id, expected.id]))[0];
    const sessions = (await this.#provider.readObservationQuery<{ n: number }>('SESSION_COUNT'))[0]?.n;
    const rows = await this.#provider.readObservationQuery<RateRow>('RATE_LIMIT_SUMMARY');
    const ownerExact = summary?.userCount === 1 && summary?.accountCount === 1 && summary?.ownerMatches === 1 && summary?.accountMatches === 1;
    return { summary, sessions, rows, ownerExact };
  }
  async captureLogoutBaseline(expected: Owner) {
    const session = providerSession(this.#provider);
    if (!session) throw new Error('PROVIDER_NOT_CONNECTED');
    if (logoutBaselines.has(this.#provider)) throw new Error('RATE_REBASELINE_FORBIDDEN');
    // Reserve before awaiting: concurrent observers cannot recapture a mutated baseline.
    logoutBaselines.set(this.#provider, { session, ownerFingerprint: digest(JSON.stringify(expected)), baseline: { status: 'Unknown' } });
    const state = await this.#ownerState(expected);
    if (providerSession(this.#provider) !== session) throw new Error('PROVIDER_NOT_CONNECTED');
    const baseline = captureRateBaseline(state.rows, { ownerExact: state.ownerExact, sessions: state.sessions });
    logoutBaselines.set(this.#provider, { session, ownerFingerprint: digest(JSON.stringify(expected)), baseline });
    return baseline.status;
  }
  authBootstrap(expected: Owner) {
    return this.#observe(async () => {
      const { summary, sessions, rows, ownerExact } = await this.#ownerState(expected);
      const stored = logoutBaselines.get(this.#provider);
      const baseline: RateBaseline = stored?.session === providerSession(this.#provider) && stored?.ownerFingerprint === digest(JSON.stringify(expected)) ? stored.baseline : { status: 'Unknown' };
      const value = { userCount: summary?.userCount, accountCount: summary?.accountCount, ownerExact, expectedMaskedEmailMatch: summary?.ownerMatches === 1, maskedEmail: '***@***', sessionCount: sessions, rateBaseline: baseline };
      return { value, state: !ownerExact || sessions !== 0 ? 'FAIL' : checkRateBaseline(rows, baseline) };
    });
  }
}
