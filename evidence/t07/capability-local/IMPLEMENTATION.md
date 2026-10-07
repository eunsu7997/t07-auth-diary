# Capability runner local implementation

Base: 9503be6cc5eb1fe79b2c32acae8ee5b4f2d9b56e. Local-only scope, Node v24.19.0.

- D-1: fixed request compiler binds method/path/exact body to private lease fingerprint. QUERY accepts IDs from a five-query read-only subset; no arbitrary SQL/params/mutating PRAGMA. Unsupported account-bound zone routes remain denied.
- D-2: fixed child entry, process.execPath, spawn shell:false/windowsHide:true, environment allowlist. node:https with dedicated TLS-validating agent, no global fetch, redirect rejection, 10s timeout, 1 MiB response cap. In-process supervisor, Node runtime and runner files are trusted base. Does not defend against hostile code modifying supervisor/builtins before load or OS compromise.
- Old CloudflareReadonlyHttp now delegates to the supervisor. During this local-only stage actual observation rejects before credentials/spawn. It cannot mint actual observations from a patched global fetch.
- Private one-use leases/receipts are implemented and tested in explicitly FAKE scope. Exact target is immutable per supervisor, request fingerprint binds method/body/action, receipt owner/session/freshness are private. Closing/failure/expiration/copy/reuse/wrong owner fails.
- Fixed real child LOCAL_CHECK runs offline and returns OFFLINE_CHECK only. It cannot mint REMOTE_CONTROL_PLANE. REMOTE_READ is hard-disabled in child and supervisor. Future actual execution needs a separately approved remote authority integration; no remote positive receipt or grant is claimed now.
- D-3: disposable TEST_RECOVERY eligibility treats policy UNKNOWN as ACCEPTED_RISK with executionApproved=false. Identity/bookmark/human approval must be present. Production and known policy denial block. This planning evaluator is not an execution issuer; no recovery write/restore is implemented in this stage.
- Freshness measured at observation completion; >30s observation duration fails. Control-plane multi-page capability remains UNKNOWN unless its complete observation can be established.

## Validation

2026-10-07 checkpoint validation: six focused suites, existing 282 + new 37 = 319 PASS / 0 FAIL. Capability suite also run separately: 37 PASS. TypeScript/build/privacy/diff PASS. App tests not rerun: no src/runtime/schema changes; delta is tooling only. Native Vite/Vitest config loader used because default bundling cannot read a sandbox parent directory; configs unchanged. Installed npx.cmd used without downloads.

Parent fetch/socket hooks observed zero calls. Child LOCAL_CHECK completes without calling network function; direct REMOTE_READ returns DENIED before HTTPS. TLS failure/real response cap/real pagination behavior have not been experimentally exercised against a remote service. No claim of actual remote transport verification.

Remote activity: Cloudflare/D1/proxy/deploy/signup/import 0. Disposable creation/testing NO; production and actual import forbidden. User requested one local checkpoint after validation on 2026-10-07; push forbidden. Independent implementation audit remains pending.
