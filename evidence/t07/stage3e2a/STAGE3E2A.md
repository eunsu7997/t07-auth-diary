> Historical initial implementation record. Current M-1/M-2 and lower-issue repairs are documented in REPAIR-M1-M2.md and repair-verification.json.

# Stage3E-2A remote provider preparation — awaiting Claude narrow audit

Baseline: `1226d899e10bb085327ce8ff68a187999e8091fa`.
This stage implements offline structures and tests, not authorization to access Cloudflare or import real data.

## Provider / transport

`DisposableRemoteD1Provider` consumes a cloned, immutable target policy. It requires DISPOSABLE_TEST, valid normalized UUID/account format, mandatory nonempty valid denylist, exact expected identity and account, explicit confirmation, and an `aleph-t07-disposable-` name. PRODUCTION_T07 is always rejected. Callers must supply the real T06/T07 denylist in a separately approved future task; no production UUID is embedded here. The provider rechecks identity before operations and invalidates retained handles on disconnect. Custom/subclass transports and method replacement are rejected.

`CloudflareD1Transport` separates query/batch/info/bookmark/writer/recovery/verification calls. FakeCloudflareD1Transport is test-only and owns a private cloned fixture. WranglerDisposableTransport prepares the installed Wrangler getPlatformProxy bridge with an explicit single DISPOSABLE_DB config, envFiles=[], persist=false and remoteBindings=true. Installed `wrangler-dist/cli.d.ts` supplied the API types. No Wrangler import occurs before the approval gate.

The private approval WeakSet has **no producer**. Both real connect and execute reject DISPOSABLE_REMOTE_TEST_NOT_APPROVED regardless of environment variables or shaped approval objects. There is no actual remote session, config creation, remote query/batch, provisioning, deployment or signup in this stage.

Actual control-plane identity, writer inventory, recovery/restore permission and verification probes are still UNKNOWN in the real transport. Binding configuration is deliberately not elevated to observed identity. Those probes need a separately audited implementation before this provider can be used for actual connections. The proxy bridge itself remains unexecuted/unverified.

## Observations and provenance

The private observation issuer accepts only connected, privately branded providers; results and nested values are frozen. WeakMap membership rejects forged/copied observations. Providers/transport instances and prototypes are frozen to prevent a caller replacing methods or spoofing connected state.

There are separate actual-remote and test-only verdicts. Successful fake transport observations are branded FAKE_TEST and can produce testOnlyPass, **never remoteEligible**. In particular, the requested fake recovery success models the REMOTE_OBSERVED producer path without claiming that any remote observation happened. Only a genuine real provider completing actual observations can issue REMOTE_OBSERVED. Pre-connect observations, missing results and query failures are UNKNOWN. No public issuer or human approval can change provenance. Stage3E-1's original private brand/gates remain unchanged; new observations do not satisfy that older brand.

## Read probes and bootstrap

- Account/database identity, purpose and naming: separate transport info, never config inference.
- d1_migrations: ordered names, compared against the five approved migration names.
- sqlite_master: separate table/index/trigger queries; normalized schema and trigger fingerprints against caller-supplied reviewed fingerprints, seventeen triggers required.
- Every business/auth table: individual count and foreign_key_list query; foreign_keys and foreign_key_check separately.
- External writers: deployments/routes/schedules/other bindings plus actual session count; missing or UNKNOWN field fails closed. HumanApproval is not substituted for these observations.
- Recovery: Time Travel availability, retention, bookmark readability, restore permission; one UNKNOWN prevents eligibility; denied permission fails. Bookmark text is never returned in evidence. No restore function is implemented.
- Verification and proxy: independent capability fields and a small successful SELECT probe.
- Auth bootstrap: read-only validation of exactly one expected user/account, credential provider and credential presence boolean, exact user/account relationships, zero sessions, real email equality (masked display), and privately branded rate baseline. No password value is selected; no signup/login endpoint is implemented or called. Fake fixture setup is not real-use evidence.

## Batch and limits

Stage3E-1 statements are copied and frozen without changing SQL/params; the original limit and unsupported-SQL checks run before submission. D1 prepare/bind/all/batch result normalization is implemented. Batch results must match statement count and report success; raw errors are replaced by fixed codes with no SQL/params/cause logging. Only fake transport can submit batches now. Remote transaction/guard/trigger behavior still needs later disposable evidence.

The field-preservation regression compares every contract field in every business table after a synthetic plan runs through memory SQLite D1 transport, independently of row order. Initial new test runs found fixture-owner mismatch and incomplete composite-key ordering in the harness; these were corrected. Existing tests were retained.

## Scope and remaining gates

Existing Stage3D60 + Stage3E1 original41 + repair38 + time regression11 = **150**, not 210 (Stage3D is already included). Current test/network/privacy metadata is in the neighboring scalar reports. App runtime/config/migrations/contracts are unchanged; browser19 is not rerun.

Still required: Claude narrow audit; an approval producer design; real control-plane observation/permission implementations; proxy access boundary; disposable batch atomicity/error evidence; approval of any future disposable creation/test/cleanup. Actual production T07 access/import remains forbidden. No commit/push and no real five-day records are performed.
