# Stage3E-1 narrow audit repairs — awaiting Claude re-audit

Baseline HEAD: `fe1fc2807f2ff6572344b04573de58fe45546afa`. The user reports the initial Stage3E-1 implementation PASS, checkpoint allowed, but disposable creation/testing NOT allowed. This document covers the subsequent M-1~M-4 and L-1~L-3 corrections, not a new audit PASS or remote approval.

## M-1 target

Database IDs must be nonblank hexadecimal UUID-shaped strings; account IDs must be nonblank 32-character hexadecimal strings. Both are trimmed/lowercased before allow/deny comparison. The account rule is based on the installed Wrangler accountIdPattern (`wrangler-dist/cli.js`), not an account name/plan guess. Denylist is mandatory/nonempty and every entry must be a valid ID. Unknown observed identity is blocked; malformed fields and case-only deny matches fail. Test IDs are randomly generated synthetic UUIDs/account IDs. No actual T06/T07 UUID is embedded in new code or evidence.

## M-2 provenance and human approvals

Observation provenance: UNKNOWN / LOCAL_SIMULATION / FAKE_TEST / REMOTE_OBSERVED. Observations are branded and immutable. The private issuing function can issue only LOCAL_SIMULATION/FAKE_TEST; there is no real remote observation producer. `remoteFactsEligible` requires each remote fact to be branded REMOTE_OBSERVED and have passing observations. It therefore remains false for this implementation. Forged REMOTE_OBSERVED objects, fake observations and local observations cannot pass even with all human approvals set.

HumanApproval is a separate kind/decision type; it cannot replace target/writer/recovery/verification/proxy observations. Candidate `allPass` describes fixture/readiness checks only and does not imply remote eligibility. Execution is additionally hard locked with REMOTE_TEST_NOT_APPROVED.

Bootstrap summaries are explicitly LOCAL_FAKE with remoteEligible=false. Remote bootstrap eligibility also requires a private producer brand; fake and forged remote summaries are rejected. LOCAL_REAL_AUTH and REMOTE_OBSERVED are future type distinctions, not implemented signup flows. `expectedMaskedEmailMatch` is computed from the actual inspected email pair; the redacted display string remains `***@***` to avoid exposing an address.

## M-3 observed rate baseline bounds

Inspected installed Better Auth 1.7.7 sources: `dist/api/rate-limiter/index.mjs`, `@better-auth/core/dist/utils/ip.mjs`; auth schema from migration 0005; protected application settings in `src/server/auth.ts`. The installed key constructor combines client identity and normalized endpoint path. No actual key/client value is written to evidence.

- Exact columns: id/key/count/lastRequest; extras/missing columns rejected.
- id: nonblank, <=128 characters, no controls.
- key: <=128 characters, no controls; supported client representation and a bootstrap endpoint must match installed structure.
- Accepted endpoint categories: signup, login, logout and session check. Count caps use current AUTH_RATE_LIMIT: signup 5, login 10, others 100; counts are safe integers >=0.
- At most 8 rows: up to four endpoint categories for at most two client identities. This is a conservative bootstrap-only safety budget allowing one client/fallback transition, not a general Better Auth database limit.
- Timestamp: safe integer epoch milliseconds within ten current 60-second windows of capture and at most 5 seconds ahead for clock skew. Excessive/stale/future/unrecognized states require review, not silent acceptance.
- Zero rows and a valid observed signup/logout baseline pass. Capture still requires an exact owner and zero sessions. Any later addition/deletion/key/count/timestamp change is detected.

HMAC with a fresh private random key is used for baseline change detection, **not encryption**. The private key and row payload stay in memory. A natural auth request can legitimately change rateLimit; a mismatch means stop/quiesce and review/re-observe after verifying the auth lifecycle, not an automatic accusation of attack or automatic rebaseline. No auth request should run during import. Actual remote keys/clock behavior and the baseline are still Unknown.

## M-4 disposable plan

15 future steps: creation with separate approval; migrations; schema/trigger/target/source checks; synthetic owner/baseline; normal batch commit; verification; reset or fresh disposable; middle error; rollback; postcondition error; rollback; normal import; duplicate rejection/unchanged verification; unknown readback; cleanup with separate approval.

The candidate includes distinct middleFailureBatch and postconditionFailureBatch plus duplicateRetryBatch. Local tests execute those against genuine memory SQLite, comparing full state and trigger fingerprints after errors. Remote execution remains forbidden regardless of confirmation. Fixture reset is never an implied instruction to reset any remote database.

## L-1 metrics separation

Initial synthetic fixture candidate: 24 statements, max binds60, max SQL869B, total SQL7519B (rerun metadata in disposable-plan-summary.json).

Actual-source dry-run numbers supplied by the user from the independent audit: 23 statements, max binds60, max SQL869B, total SQL7440B. These are a distinct reported measurement; **Codex did not perform an actual-source import/dry-run in this repair turn**. They must not be described as the synthetic fixture's final metrics. See source-metrics-comparison.json. New failure scenarios add separate test batches, not extra statements to the normal import batch.

## L-3 canonical recovery

New code uses recoveryMeaning: automaticRetry=false for all outcomes; humanApprovalRequired=true for NOT_EXECUTED and UNEXPECTED_PARTIAL_OR_UNKNOWN, false/action=none for COMPLETED. The old Stage3D recoveryDecision is marked deprecated/local-history only and is never used by remote preparation. Its historical behavior and existing tests are unchanged.

## Current verification / limits

Stage3D60 + original Stage3E-1 41 + supplement38 = 139 local tests PASS, FAIL0. Runtime src/config/migrations/contracts unchanged; Stage3D change is only a deprecated JSDoc comment. Existing unit/API136 and browser19 are not rerun in this narrow repair; their history is preserved. Current TypeScript/build/privacy/whitespace results are recorded in repair-verification.json.

No disposable created, no connect/remote binding/request, no real signup/import, no deploy/secret, no five-day records, no commit/push. Test fixture preparation is synthetic local activity only. The remote observer/transport and actual D1 schema/rollback remain unverified and require separate approval after Claude re-audit.
