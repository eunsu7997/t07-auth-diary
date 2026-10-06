# Stage3E-1 — D1 preparation, no remote execution

Baseline: `fe1fc2807f2ff6572344b04573de58fe45546afa`. All Stage3D implementation/tests and historical evidence are unchanged. New preparation modules are outside the app/Worker dependency graph. No commit/push is performed.

This document preserves the initial Stage3E-1 implementation record. Current M-1~M-4 corrections, provenance/baseline restrictions and the deprecated Stage3D recovery annotation are documented in REPAIR-M1-M4.md; initial test counts below are historical, not the current repair count.

## M-1: observed rateLimit baseline

The new preparation path replaces fixed zero with a private baseline captured after the fake loopback adapter has completed signup/logout and inspected an exact owner/account pair with session count zero. Zero and nonzero row baselines are supported. IDs/keys/counts/time fields undergo structural validation, and a per-baseline random HMAC key protects the private comparison fingerprint. Neither the HMAC key/fingerprint nor rateLimit keys, paths or full rows are written to evidence. Baseline capture times and row counts are safe summaries only.

Unknown, forged, pre-logout or wrong-owner baselines cannot pass. Added/changed/invalid rows fail both read preflight and the in-batch comparison. First/final guards compare the captured row set via bound parameters without modifying rateLimit. Actual Better Auth remote signup, key shapes and observed baseline remain unverified; a fixture row is not proof of production behavior. Stage3D's historical fixed-zero path stays unchanged for its 60 regression tests; future D1 preparation uses the new path.

## M-2: observers and remaining approvals

`RemoteSafetyObserver` separates target identity, writers, recovery, verification, leak configuration and proxy permission observations. Results are branded, cloned and frozen; a plain object with Observed/true cannot masquerade as an observer-issued result. Fake observations are labeled fake. The local observer checks configuration plus process argv/env for source JSON and exposed VITE auth variables, and returns Unknown for Cloudflare facts. It does not infer deployment absence from a local Wrangler file.

The new 37-check preflight consumes actual fixture SQL reads and observer results. Derived checks override caller approval entries, so adding PASS cannot turn an unknown writer/recovery/permission fact into PASS. Manual design/implementation reviews, source strategy approval, stopped/drained lifecycle, single operator/bookmark/disposable proof and restore approval remain explicit unresolved gates. Fixture observations and caller review flags never grant remote execution: `executionApproved=false` in every preparation result.

## Provider / D1 adapter boundaries

`RemoteD1Provider` and `D1DatabaseLike` define prepare/bind/all/batch shape. Constructing or importing CloudflareD1Provider/D1PreparationAdapter does not call the provider. Remote connect/execution methods are present as locked stubs, throwing REMOTE_TEST_NOT_APPROVED; connect is never called this stage. No Wrangler/network transport is imported or implemented.

Only the branded local fixture factory initializes a database handle. Arbitrary providers are rejected before getDatabase is called. The fixture runs genuine memory SQLite transactions with the existing 17 triggers and FK enforcement. It replaces only its private memory migration registry with `d1_migrations`; existing migrations/DBs are untouched. Local `_migrations` and D1 `d1_migrations` remain distinct paths. This fixture table shape is not a new observation of actual Cloudflare metadata.

Schema inspection uses three small sqlite_master queries and individual direct PRAGMA foreign_key_list('table') reads, not table-valued pragma functions or Wrangler stdout pipelines. Fingerprints normalize CRLF and token whitespace, preserve literal contents/quoted identifiers and compare sorted object names/structure. The approved expected fixture schema is built independently from migrations whose hashes Stage3D pins. Real D1 platform objects/registry shape and a reviewed actual remote fingerprint must be established later.

## SQL and future disposable candidate

The generator retains bound JSON comparisons because D1 explicitly documents JSON1. Task restoration now uses per-task bound UPDATE; no UPDATE FROM or integer-overflow guard remains in the new candidate. Conditional malformed JSON extraction provides a real SQL error on guard failure. Local SQLite tests prove all fields/owners/triggers remain intact and forced failure/rate drift rolls back. Exact CASE/JSON/batch behavior through remote proxy remains a mandatory disposable gate, even for documented syntax. See SQL-COMPATIBILITY.md for A/B/C classification.

Candidates contain target/schema/migration/trigger/source/owner/rate checks, batch and forced-failure batch plans, rollback and unknown-classification steps. Unknown gates may be listed on an offline candidate, but cannot authorize execution; absent rate baseline cannot even construct comparison guards. Any measured >100 binds/query, >100000 SQL bytes/statement or >50 statements rejects the plan. Candidate summaries omit SQL/bind values, owner identity and target UUID.

RemoteTargetPolicy compares runtime-provided expected/observed database and account, applies a denylist before approval, restricts this test plan to disposable purpose and requires explicit confirmation. No real database UUID is embedded in new code/tests. Expected/observed Unknown blocks eligibility; confirmation cannot bypass the unconditional remote execution lock.

NOT_EXECUTED requires human approval before any remote resubmission. COMPLETED requires no action; unexpected/unknown requires human intervention. Every state has automaticRetry=false. Source/outcome validation still uses the existing Stage3D classifier contract; trustworthy remote-settled observations are not implemented or claimed.

## Verification and privacy

All Stage3D 60 tests are retained. New tests exercise 0/1 rate baselines, changed/invalid rates, unknown/forged observers, target allow/deny/confirmation, D1 return fixtures/registry, schema/trigger normalization, SQL generation and real local rollback, locked providers, fresh module imports and accidental provider injection. Fetch and Socket.connect tripwires throw on any call while running the new tests; network-observation.json records counts and scope. Source-text/secret/evidence-key/dist scans are in privacy-check.json.

The full existing unit/API set is also rerun. Browser regression 19 is not rerun: app runtime/UI/config are unchanged, prior Stage3D evidence records their PASS, and these Node-only modules are absent from production dist. No old 155-test evidence is rewritten. TypeScript/build and git whitespace checks run on current changes.

Final current unit/API results: existing 136 + Stage3D 60 + new Stage3E-1 41 = **237 PASS, 0 FAIL**. Latest focused Stage3D/Stage3E-1 run is 101 PASS. TypeScript/build/privacy PASS. The synthetic disposable candidate measures 24 statements, max 60 binds, max SQL 869 bytes and total SQL 7,519 bytes; its 25-statement forced-failure batch was executed only against memory SQLite. No actual-source import is run this stage.

Official documentation was read via the documentation browsing tool only. No Cloudflare account API, D1 service request, socket/fetch from the new tooling, Wrangler remote session or cloud resource operation was executed. Network counters cover test execution, not unrelated test-runner/build process internals or documentation browsing; static dependency checks complement runtime tripwires.

## Remaining gates

- Claude narrow implementation review before Stage3E-2 or disposable creation.
- Actual proxy/provider transport and real target identity/deployment/writer/permission observations are not implemented; they remain Unknown.
- Actual Better Auth loopback/remote signup and nonzero rate baseline semantics are not verified.
- Exact remote schema/registry/platform internal objects, guarded query support, payload/time limits, proxy rollback and lost-response settling require authorized disposable tests.
- Real bookmark/retention/restore observations, recovery permission method and human approvals are still required. No Time Travel operation is performed.
- Token-based whitespace comparison and unsafe-expression detection are conservative checks, not full SQL parsers/equivalence proofs.

Real signup/import, D1 remote operations, preview, deploy, secrets, disposable creation and five-day records: 0. Actual T07 import remains forbidden.
