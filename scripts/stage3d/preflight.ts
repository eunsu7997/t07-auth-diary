import { readFileSync } from 'node:fs';
import { tables, isLoaded, type Source, type Counts } from './source.ts';
import type { Inspection, Owner } from './adapters.ts';
export type CheckState = 'PASS' | 'FAIL' | 'UNKNOWN';
export type Known = boolean | 'UNKNOWN';
export type RecoveryCapability = { available: Known; retentionDays: number | 'UNKNOWN'; canReadBookmark: Known; canRestore: Known };
export type ImportSafetyState = {
  productionWorkerExists: Known; routesExist: Known; otherBindingsExist: Known; scheduledWritersExist: Known;
  activeSessions: number | 'UNKNOWN'; externalWriterCheck: Known;
};
export type Policy = {
  // Remote gates can only be simulated in local scope. This is never remote eligibility.
  scope: 'local-simulation'; identifier: string; allowedSha: string; counts: Counts; owner: Owner; baseline: Inspection;
  safety: ImportSafetyState; recovery: RecoveryCapability;
  attestations: Record<string, Known>; bookmarkWithinRetention: Known;
};
const checklist = JSON.parse(readFileSync(new URL('../../evidence/t07/stage3c-design/preflight-checklist.json', import.meta.url), 'utf8')) as {checkCount: number; checks: {id: string; require: string}[]};
if (checklist.checkCount !== 37 || checklist.checks.length !== 37 || new Set(checklist.checks.map(c => c.id)).size !== 37) throw new Error('CHECKLIST_INVALID');
const state = (v: Known): CheckState => v === true ? 'PASS' : v === false ? 'FAIL' : 'UNKNOWN';
const and = (...values: Known[]): Known => values.includes(false) ? false : values.some(v => v !== true) ? 'UNKNOWN' : true;
export function externalWriterSafe(s: ImportSafetyState): Known {
  return and(...[s.productionWorkerExists, s.routesExist, s.otherBindingsExist, s.scheduledWritersExist].map(v => v === false ? true : v === true ? false : 'UNKNOWN'),
    s.activeSessions === 'UNKNOWN' ? 'UNKNOWN' : s.activeSessions === 0, s.externalWriterCheck);
}
export function recoverySafe(r: RecoveryCapability): Known {
  return and(r.available, r.canReadBookmark, r.canRestore, r.retentionDays === 'UNKNOWN' ? 'UNKNOWN' : Number.isInteger(r.retentionDays) && r.retentionDays > 0);
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function runPreflight(source: Source, actual: Inspection, policy: Policy) {
  const a = (key: string): Known => policy.attestations[key] ?? 'UNKNOWN';
  const empty = tables.every(t => actual.counts[t] === 0);
  const owner = actual.users.length === 1 && actual.users[0].id === policy.owner.id && actual.users[0].email === policy.owner.email;
  const account = actual.accounts.length === 1 && actual.accounts[0].providerId === 'credential' && actual.accounts[0].userId === policy.owner.id && actual.accounts[0].accountId === policy.owner.id && actual.accounts[0].credentialPresent;
  const migrations = same(actual.migrations, policy.baseline.migrations) && actual.migrations.length === 5 && same(actual.migrationHashes, policy.baseline.migrationHashes);
  const schema = actual.schemaFingerprint === policy.baseline.schemaFingerprint;
  const triggers = actual.triggerFingerprint === policy.baseline.triggerFingerprint && actual.schema.filter(r => r.type === 'trigger').length === 17;
  const writer = externalWriterSafe(policy.safety); const recovery = recoverySafe(policy.recovery);
  const values: Record<string, Known> = {
    P01: and(a('designApproved'), a('executionAuthorized')), P02: and(a('implementationReviewed'), a('cleanWorktree')),
    P03: policy.scope === 'local-simulation', P04: actual.identifier === policy.identifier && policy.identifier.startsWith('local-'),
    P05: and(a('localOnlyAdapter'), a('loopbackOnly'), a('disposePlanned')), P06: isLoaded(source) && source.sha === policy.allowedSha,
    P07: same(source.counts, policy.counts) && source.data.schema_version === '2.0.0', P08: isLoaded(source), P09: isLoaded(source) && source.data.execution_logs.every(e => e.ended_at !== null),
    P10: migrations, P11: schema, P12: triggers, P13: empty, P14: and(owner, a('ownerBootstrapConfirmed')), P15: account,
    P16: and(actual.sessions === 0, a('listenerStopped'), a('requestsDrained')), P17: actual.fkClean && actual.foreignKeys,
    P18: writer, P19: and(writer, a('singleOperator'), a('localLock')), P20: and(a('bookmarkRecorded'), actual.sessions === 0, writer),
    P21: recovery, P22: a('limitsMeasured'), P23: a('disposableProof'), P24: a('verificationPlan'),
    P25: owner && account, P26: owner, P27: actual.sessions === 0,
    P28: owner && account && actual.sessions === 0 && actual.verification === 0 && actual.rateLimit === 0,
    P29: a('proxyPermission'), P30: a('verificationPermission'), P31: a('leakSafe'),
    P32: and(actual.settled, writer, a('freshRead')), P33: schema, P34: triggers, P35: empty,
    P36: and(recovery, policy.bookmarkWithinRetention), P37: and(recovery, a('restorePermissionMethod'), a('separateRestoreApproval')),
  };
  const checks = checklist.checks.map(c => ({ id: c.id, state: state(values[c.id] ?? 'UNKNOWN') }));
  return { scope: policy.scope, checks, allowed: checks.every(c => c.state === 'PASS'), remoteEligible: false as const };
}
