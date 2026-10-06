import { randomBytes, createHmac } from 'node:crypto';
import { digest } from '../stage3d/source.ts';
import { externalWriterSafe, recoverySafe, type ImportSafetyState, type RecoveryCapability, type CheckState } from '../stage3d/preflight.ts';
import type { Outcome } from '../stage3d/import-plan.ts';
import { AUTH_RATE_LIMIT } from '../../src/server/auth.ts';
export type Provenance = 'UNKNOWN' | 'LOCAL_SIMULATION' | 'FAKE_TEST' | 'REMOTE_OBSERVED';
export type HumanApproval = { kind: 'HumanApproval'; decision: 'APPROVED' | 'REJECTED' | 'UNKNOWN' };
export type Observation<T> = { status: 'Observed'; value: T; origin: Exclude<Provenance, 'UNKNOWN'>; observedAt: number } | { status: 'Unknown'; origin: 'UNKNOWN' };
const observations = new WeakSet<object>();
function observed<T>(value: T, origin: 'LOCAL_SIMULATION' | 'FAKE_TEST'): Observation<T> {
  const copy = structuredClone(value);
  const freeze = (v: unknown) => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } }; freeze(copy);
  const result = Object.freeze({ status: 'Observed' as const, value: copy, origin, observedAt: Date.now() });
  observations.add(result); return result;
}
export const unknown = <T>(): Observation<T> => ({ status: 'Unknown', origin: 'UNKNOWN' });
export function readObservation<T>(o: Observation<T>): T | undefined {
  return o.status === 'Observed' && observations.has(o) ? o.value : undefined;
}
export type TargetIdentity = { accountId: string; databaseId: string; purpose: 'disposable' | 'production' };
export interface RemoteSafetyObserver {
  observeTargetIdentity(): Promise<Observation<TargetIdentity>>;
  observeExternalWriters(): Promise<Observation<ImportSafetyState>>;
  observeRecoveryCapability(): Promise<Observation<RecoveryCapability>>;
  observeVerificationCapability(): Promise<Observation<{ read: boolean; review: boolean; export: boolean; attackTests: boolean }>>;
  observeLeakSafety(): Promise<Observation<{ safe: boolean }>>;
  observeProxyPermission(): Promise<Observation<{ allowed: boolean }>>;
}
export type ObserverFixture = {
  target?: TargetIdentity; writers?: ImportSafetyState; recovery?: RecoveryCapability;
  verification?: { read: boolean; review: boolean; export: boolean; attackTests: boolean }; leakSafe?: boolean; proxyAllowed?: boolean;
};
export class FakeRemoteSafetyObserver implements RemoteSafetyObserver {
  constructor(private readonly fixture: ObserverFixture) {}
  private value<T>(v: T | undefined) { return v === undefined ? unknown<T>() : observed(v, 'FAKE_TEST'); }
  async observeTargetIdentity() { return this.value(this.fixture.target); }
  async observeExternalWriters() { return this.value(this.fixture.writers); }
  async observeRecoveryCapability() { return this.value(this.fixture.recovery); }
  async observeVerificationCapability() { return this.value(this.fixture.verification); }
  async observeLeakSafety() { return this.value(this.fixture.leakSafe === undefined ? undefined : { safe: this.fixture.leakSafe }); }
  async observeProxyPermission() { return this.value(this.fixture.proxyAllowed === undefined ? undefined : { allowed: this.fixture.proxyAllowed }); }
}
// No Cloudflare inference from local config. Deployment/permission facts stay Unknown.
export class LocalSafetyObserver extends FakeRemoteSafetyObserver {
  constructor(private readonly config: { debugBindings: boolean; sourceInArgs: boolean; sourceInEnv: boolean; evidenceContainsValues: boolean }) { super({}); }
  override async observeLeakSafety() {
    const sourceArgument = process.argv.some(v => v.includes('"schema_version"') || v.trim().startsWith('{'));
    const sourceEnvironment = Object.values(process.env).some(v => v?.includes('"schema_version"'));
    const exposedAuthEnvironment = Object.keys(process.env).some(k => /^VITE_.*(?:AUTH|TOKEN|SECRET)/i.test(k));
    const safe = Object.values(this.config).every(v => v === false) && !sourceArgument && !sourceEnvironment && !exposedAuthEnvironment;
    return observed({ safe }, 'LOCAL_SIMULATION');
  }
}
export type SafetyObservations = Awaited<ReturnType<typeof observeSafety>>;
export async function observeSafety(observer: RemoteSafetyObserver) {
  // Separate observations, not a caller-provided all-green attestation.
  return { target: await observer.observeTargetIdentity(), writers: await observer.observeExternalWriters(), recovery: await observer.observeRecoveryCapability(),
    verification: await observer.observeVerificationCapability(), leak: await observer.observeLeakSafety(), proxy: await observer.observeProxyPermission() };
}
export type RemoteTargetPolicy = { expectedDatabaseId: string | 'UNKNOWN'; expectedAccountId: string | 'UNKNOWN'; deniedDatabaseIds: readonly string[]; explicitConfirmation: boolean; targetObserved: Observation<TargetIdentity> };
export function checkTarget(policy: RemoteTargetPolicy): { confirmation: CheckState; identity: CheckState } {
  const value = readObservation(policy.targetObserved);
  const confirmation = policy.explicitConfirmation === true ? 'PASS' : 'FAIL';
  const dbId = (id: unknown) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim()) ? id.trim().toLowerCase() : undefined;
  // Installed Wrangler cli.js uses 32 hexadecimal account IDs. No assumption about plan/name.
  const accountId = (id: unknown) => typeof id === 'string' && /^[0-9a-f]{32}$/i.test(id.trim()) ? id.trim().toLowerCase() : undefined;
  if (!Array.isArray(policy.deniedDatabaseIds) || policy.deniedDatabaseIds.length === 0) return { confirmation, identity: 'FAIL' };
  const denied = policy.deniedDatabaseIds.map(dbId);
  if (denied.some(id => !id)) return { confirmation, identity: 'FAIL' };
  const expected = policy.expectedDatabaseId === 'UNKNOWN' ? undefined : dbId(policy.expectedDatabaseId);
  const expectedAccount = policy.expectedAccountId === 'UNKNOWN' ? undefined : accountId(policy.expectedAccountId);
  if ((policy.expectedDatabaseId !== 'UNKNOWN' && !expected) || (policy.expectedAccountId !== 'UNKNOWN' && !expectedAccount)) return { confirmation, identity: 'FAIL' };
  if (expected && denied.includes(expected)) return { confirmation, identity: 'FAIL' };
  if (value && (!dbId(value.databaseId) || !accountId(value.accountId))) return { confirmation, identity: 'FAIL' };
  if (value && denied.includes(dbId(value.databaseId))) return { confirmation, identity: 'FAIL' };
  if (policy.expectedDatabaseId === 'UNKNOWN' || policy.expectedAccountId === 'UNKNOWN' || !value) return { confirmation, identity: 'UNKNOWN' };
  return { confirmation, identity: dbId(value.databaseId) === expected && accountId(value.accountId) === expectedAccount && value.purpose === 'disposable' ? 'PASS' : 'FAIL' };
}
export function remoteFactsEligible(o: SafetyObservations) {
  return Object.values(o).every(v => v.status === 'Observed' && v.origin === 'REMOTE_OBSERVED' && observations.has(v)) &&
    Object.values(observedChecks(o)).every(s => s === 'PASS');
}
export function observedChecks(o: SafetyObservations) {
  const writer = readObservation(o.writers); const recovery = readObservation(o.recovery); const verification = readObservation(o.verification);
  const state = (v: boolean | 'UNKNOWN'): CheckState => v === true ? 'PASS' : v === false ? 'FAIL' : 'UNKNOWN';
  return { writers: state(writer ? externalWriterSafe(writer) : 'UNKNOWN'), recovery: state(recovery ? recoverySafe(recovery) : 'UNKNOWN'),
    verification: state(verification ? Object.values(verification).every(v => v === true) : 'UNKNOWN'),
    leak: state(readObservation(o.leak)?.safe ?? 'UNKNOWN'), proxy: state(readObservation(o.proxy)?.allowed ?? 'UNKNOWN') };
}
export type RateRow = { id: string; key: string; count: number; lastRequest: number };
export type RateBaseline = { status: 'Unknown' } | { status: 'Observed'; count: number; observedAt: number };
const rateBaselines = new WeakMap<object, { salt: Buffer; fingerprint: string; rows: RateRow[] }>();
export const RATE_BASELINE_LIMITS = { rows: 8, keyLength: 128, futureSkewMs: 5000, maxAgeMs: AUTH_RATE_LIMIT.window * 10 * 1000 } as const;
const allowedRatePaths: Record<string, number> = { '/sign-up/email': AUTH_RATE_LIMIT.signupMax, '/sign-in/email': AUTH_RATE_LIMIT.loginMax, '/sign-out': AUTH_RATE_LIMIT.otherMax, '/get-session': AUTH_RATE_LIMIT.otherMax };
function validRateClient(client: string) {
  if (client === 'no-trusted-ip') return true; // Installed Better Auth fallback.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(client)) return client.split('.').every(v => Number(v) <= 255 && String(Number(v)) === v);
  if (!/^[0-9a-f:]+$/i.test(client) || !client.includes(':')) return false;
  try { return new URL(`http://[${client}]/`).hostname.length > 0; } catch { return false; } // URL parsing only, no I/O.
}
function validateRateRowsShape(rows: RateRow[]) {
  if (!Array.isArray(rows) || rows.length > RATE_BASELINE_LIMITS.rows) return false;
  if (rows.some(r => !r || typeof r !== 'object' || Object.keys(r).sort().join(',') !== 'count,id,key,lastRequest')) return false;
  const clients = new Set<string>();
  return new Set(rows.map(r => r.id)).size === rows.length && new Set(rows.map(r => r.key)).size === rows.length && rows.every(r => {
    if (typeof r.id !== 'string' || !r.id.trim() || r.id.length > 128 || /[\x00-\x1f\x7f]/.test(r.id) || typeof r.key !== 'string' || !r.key.trim() || r.key.length > RATE_BASELINE_LIMITS.keyLength || /[\x00-\x1f\x7f]/.test(r.key)) return false;
    const parts = r.key.split('|'); if (parts.length !== 2 || !validRateClient(parts[0]) || !Object.hasOwn(allowedRatePaths, parts[1])) return false;
    clients.add(parts[0]);
    return Number.isSafeInteger(r.count) && r.count >= 0 && r.count <= allowedRatePaths[parts[1]] && Number.isSafeInteger(r.lastRequest) && clients.size <= 2;
  });
}
function validateRateRowsForCapture(rows: RateRow[], now: number) {
  return validateRateRowsShape(rows) && rows.every(r =>
    r.lastRequest >= now - RATE_BASELINE_LIMITS.maxAgeMs && r.lastRequest <= now + RATE_BASELINE_LIMITS.futureSkewMs);
}
const canonical = (rows: RateRow[]) => JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id)));
export function captureRateBaseline(rows: RateRow[], afterLogout: { ownerExact: boolean; sessions: number }): RateBaseline {
  const now = Date.now();
  if (!afterLogout.ownerExact || afterLogout.sessions !== 0 || !validateRateRowsForCapture(rows, now)) return { status: 'Unknown' };
  const salt = Buffer.from(randomBytes(32)); const fingerprint = createHmac('sha256', salt).update(canonical(rows)).digest('hex');
  const baseline = Object.freeze({ status: 'Observed' as const, count: rows.length, observedAt: now });
  rateBaselines.set(baseline, { salt, fingerprint, rows: structuredClone(rows) }); return baseline;
}
export function checkRateBaseline(rows: RateRow[], baseline: RateBaseline): CheckState {
  if (!validateRateRowsShape(rows)) return 'FAIL';
  const privateState = rateBaselines.get(baseline);
  if (baseline.status !== 'Observed' || !privateState) return 'UNKNOWN';
  return createHmac('sha256', privateState.salt).update(canonical(rows)).digest('hex') === privateState.fingerprint ? 'PASS' : 'FAIL';
}
export function baselineRows(baseline: RateBaseline) { return rateBaselines.get(baseline)?.rows.map(r => ({ ...r })); }
export function recoveryMeaning(outcome: Outcome) { return { outcome, automaticRetry: false as const, humanApprovalRequired: outcome !== 'COMPLETED', humanInterventionRequired: outcome !== 'COMPLETED', action: outcome === 'COMPLETED' ? 'none' : 'human-approval-required' }; }
export const fingerprint = (rows: unknown) => digest(JSON.stringify(rows));
