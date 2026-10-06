# Disposable approval and actual control-plane issuers

Baseline: `b77611161a464aa408f88528edd8a07f613c5271`. Scope: two components only. No actual Cloudflare account request, proxy open, D1 provisioning, production access, signup/import, deploy or commit/push.

## Approval

Private issue() stores immutable opaque approval objects in a private WeakMap. It binds normalized DB/account/name, registered live session, transport origin, CONNECT/BATCH action, expiration (maximum 30 seconds) and used state. Environment variables never mint approvals. A registered DisposableApprovalAuthority is invoked within the provider's pending CONNECT or live BATCH context; it requires a fresh privately issued actual control-plane precheck. Wrong target/account/session/action, expiration, closed session, forged/copied/reused tokens and production targets fail. Consumption is synchronous before transport I/O; a failed or unknown submission does not authorize retry.

Fixture approvals use the identical private mint/verification path but are explicitly FAKE_TRANSPORT only. They cannot satisfy actual transport boundaries, which force REMOTE_TRANSPORT regardless of caller fields. Positive one-time tests include provider -> fake transport consumption and prove one submission only; they are not actual Cloudflare permission evidence. Production authority rejects fake/local/UNKNOWN facts. A new session is minted by the provider before CONNECT and invalidated on close/transport termination.

## Actual observer

CloudflareReadonlyHttp performs explicit GET calls only when invoked, with an explicit credential callback, fixed API origin, redirect rejection, timeouts and normalized errors. Import/construction never fetch or inspect credentials. Allowed D1 metadata/bookmark paths are bound to the exact disposable ID/account; production inventory is protected using existing repo bindings. FakeControlPlaneHttp is separately privately branded and never yields REMOTE_CONTROL_PLANE. Actual observation branding occurs only after the actual client's successful validated response; copied/forged objects lack WeakMap freshness/target membership. Results are immutable and prechecks require freshness within 30 seconds.

Implemented GET parsers: account details; database UUID/name; paginated Workers inventory and script settings; D1 binding matches; deployment/schedule inventory; account-filtered zones/routes; bookmark readability; verified account token policy scoped to D1 Write; verification observation with explicit Unknown app capabilities. Missing pages, permission errors, unsupported policy details, malformed or mismatched identity produce UNKNOWN or denied capability, never an absence/permission inference. No restore/write/query is used as a permission probe.

Remaining measured-capability gaps: GET bookmark does not report effective retention days. Workers inventory does not establish all nonstandard/dispatch writer paths. Cloudflare database metadata does not prove application review/export/attack-test capability. These fields remain UNKNOWN, so current actual control-plane precheck and actual approval issuance do not open a proxy. The actual issuer code path is implemented, but a genuinely positive full remote grant has not been demonstrated. Disposable trial readiness is **NO**, pending independent audit and actual capability evidence under separate authorization.

Official API references checked during implementation (documentation browsing only):

- [Account identity](https://developers.cloudflare.com/api/resources/accounts/methods/get/)
- [D1 identity](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/get/)
- [Worker settings](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/settings/methods/get/)
- [Cron schedules](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/schedules/methods/get/)
- [Bookmark GET](https://developers.cloudflare.com/api/resources/d1/subresources/database/subresources/time_travel/methods/get_bookmark/)
- [Restore permission reference](https://developers.cloudflare.com/api/resources/d1/subresources/database/subresources/time_travel/methods/restore/)
- [Account token policy API](https://developers.cloudflare.com/api/resources/accounts/)

Existing 243 tests remain unchanged. New fixture/HTTP-parser tests and current scalar validation results are in verification-summary.json. Earlier stage evidence remains historical. TypeScript/build/privacy/whitespace are validated locally; no actual secrets, full credentials or production IDs are recorded in new evidence. Real five-day records are not generated.
