# Stage3E-2A repair — awaiting Claude re-audit

Baseline: `1226d899e10bb085327ce8ff68a187999e8091fa`.
The user reports the initial narrow audit implementation PASS/checkpoint YES, disposable creation/testing NO. This document records subsequent M-1/M-2 and L-1/L-2/L-3/L-4/L-5/L-6/L-9 repairs. It is not a new Claude verdict or execution approval. Prior verification-summary.json remains the initial 208-test record.

## M-1 lifecycle and sessions

Provider states are CREATED -> CONNECTING -> CONNECTED -> CLOSED. CONNECTING is assigned before the first await. Parallel connects have one winner; additional connects, failed-connect reuse and CLOSED reconnects are rejected. Disconnect clears the private WeakMap session object immediately. A connect pending during close cannot resurrect it. Underlying transport termination also invalidates provider state/session.

Observation brands now store the provider and its exact connection session object. Observations issued after an awaited operation require the same session; copied/forged/stale observations cannot reactivate. Retained database handles recheck readiness. A new provider connection cannot revive an old provider's results.

## M-2 reads and sensitive results

The public read(sql) API is removed. readObservationQuery accepts only registered query IDs. The private registry generates exact SQL, fixed columns and approved table names; parameter arity/types are checked. Prepared .all() also requires an exact registry match. Arbitrary SELECT/PRAGMA and direct sensitive-column reads are rejected.

AUTH_OWNER_SUMMARY returns only counts and exact-match booleans, using bound expected owner values. It does not return email/credential/user rows. Credential presence is checked by a SQL boolean expression, never credential extraction. Query projection strips unexpected columns and rejects nested payloads. Batch callers receive success with empty results; arbitrary batch response data is not exposed. General fake batch submissions are privileged synthetic fixture operations, not observer reads or real remote permission.

## Lower issue repairs

- L-1: Bind types (including bigint) are rejected with D1_STATEMENT_INVALID before JSON-based measurement.
- L-2: Transport origin is REMOTE_TRANSPORT/FAKE_TRANSPORT/UNKNOWN. Observation provenance is separate, and REMOTE_OBSERVED is never a provider construction claim.
- L-3: captureLogoutBaseline is an explicit post-logout operation. It verifies the exact owner and zero sessions, reserves the slot before awaiting, captures once and stores the private branded baseline per provider/session/owner. New observers cannot recapture. Later authBootstrap uses checkRateBaseline only: unchanged rows pass after 11/60 minutes; add/delete/key/count/timestamp changes fail. No capture/automatic rebaseline occurs during observation. Failed capture remains Unknown and requires a new controlled lifecycle, not silent retry.
- L-4: Disposable classification depends on expected naming/ID/account/denylist and exact observed identity. Transport self-reported purpose is only a conservative production veto.
- L-5: ControlPlaneObserver defines account/database/writer/recovery probes. Only FakeControlPlaneObserver exists. Real proxy connect requires privately issued REMOTE_CONTROL_PLANE evidence before target revalidation, approval validation, config reads or Wrangler import/open. UNKNOWN/fake/forged facts cannot open a proxy. No actual control-plane issuer/call exists.
- L-6: Required caller denylist is unioned privately with IDs read from the fixed T07 and T06 repository production binding files. Invalid/missing/unreadable files fail closed. IDs are neither hardcoded nor written to evidence/errors. This is a local binding inventory, not a claim of Cloudflare identity.
- L-9: The same execute approval object and exact target/session/action context flow through provider batch to transport batch. There is no requireDisposableApproval(undefined) placeholder. The private approval record design binds target, account, session, action, expiration and used flag; only immutable, registered objects can pass and transport consumes once before submission. There is no issuer (including test issuer), so no valid approval exists. Missing/shaped/copied/reused invalid objects are rejected. Positive valid-approval and real one-time execution remain untested until a separately audited issuer exists.

## Scope / verification

Original 150 Stage3D/E1 tests and 58 Stage3E2A tests are retained. Existing Stage3E2A tests were adapted to the restricted query API, explicit baseline capture and normalized terminal-connect rejection; none were deleted. New repair test counts are in repair-verification.json. TypeScript/build/privacy/whitespace checks are local only. App runtime/config/migrations/contracts and Stage3E1 code are unchanged; browser19 is not rerun.

No fetch/socket/Cloudflare/proxy/remote D1/deploy/real signup/import activity occurs. Fake memory SQLite setup remains synthetic. No commit/push or real five-day records. Remaining gates: Claude re-audit, actual control-plane/remote transport validation, approval issuer design (including CONNECT session binding), and separately authorized disposable tests. Production T07 access and actual import remain forbidden.
