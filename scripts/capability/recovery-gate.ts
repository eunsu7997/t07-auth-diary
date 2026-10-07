import { normalizeTarget, type TargetPolicy } from '../stage3e2a/transport.ts';
export type RecoveryProbeFacts = Readonly<{ identity: boolean | 'UNKNOWN'; bookmark: boolean | 'UNKNOWN'; disposableApproved: boolean; policyPermission: boolean | 'UNKNOWN' }>;
// Planning eligibility only. Never an execution approval or REMOTE_OBSERVED value.
export function evaluateRecoveryProbe(policy: TargetPolicy, facts: RecoveryProbeFacts) {
  normalizeTarget(policy);
  if (![true, false, 'UNKNOWN'].includes(facts.identity) || ![true, false, 'UNKNOWN'].includes(facts.bookmark) || ![true, false, 'UNKNOWN'].includes(facts.policyPermission)) return Object.freeze({ state: 'DENIED' as const, executionApproved: false as const });
  if (facts.disposableApproved !== true || facts.identity !== true || facts.bookmark !== true || facts.policyPermission === false) return Object.freeze({ state: 'DENIED' as const, executionApproved: false as const });
  return Object.freeze({ state: facts.policyPermission === 'UNKNOWN' ? 'ACCEPTED_RISK' as const : 'ELIGIBLE' as const, executionApproved: false as const, scope: 'DISPOSABLE_TEST_RECOVERY_ONLY' as const });
}
