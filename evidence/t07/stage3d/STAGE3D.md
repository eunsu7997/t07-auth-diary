# Stage 3D — local-only import implementation

Baseline: `4cd7217d415f2bdd1a800c7127e44877d1f248c4`. This is an uncommitted local implementation awaiting Claude Code review. No remote import approval is implied.

## Boundaries and execution

All new database execution uses `LocalImportDatabase`, which accepts no file path and opens only `:memory:`. `FakeRemoteImportDatabase` is the same local SQLite implementation with an explicit test-double label. `openRemoteImportDatabase()` always throws `REMOTE_IMPORT_NOT_IMPLEMENTED`; there is no Wrangler import, remote binding, HTTP client, Worker endpoint, environment override, or remote enabling switch. Existing app code, migrations, contracts and Wrangler configuration are unchanged. Production build excludes this Node tooling.

The fake bootstrap inserts synthetic relationships and random opaque fixture values in local memory, then deletes its local session. It does not test Better Auth hashing, signup behavior, origins or remote adapters. Existing Better Auth regression tests run independently with local automated accounts. None are real signup/use evidence.

## Source and 37 preflight checks

The loader verifies bytes SHA before parsing, checks contract v2, counts, keys/uniques/FKs/current versions/completion/duration and trigger-safe copy ordering. All failures have static codes and exclude Ajv/SQLite value-bearing errors. Loaded data is recursively frozen and branded. Actual-source loading defaults to the approved Stage3C SHA. Synthetic tests explicitly use their own hash within local simulation; this is not a new approved remote source strategy. File bytes are zeroed after parsing; process exit releases in-memory source and bound values, without promising physical memory erasure.

`preflight.ts` loads the approved 37 IDs from Stage3C and returns PASS/FAIL/UNKNOWN. Missing/unverified attestations are UNKNOWN and block. Owner ID/email pair, accountId/userId/provider/credential presence, sessions, auth baseline, business emptiness, FK, schema and all 17 triggers are inspected from SQLite. Migration files are compared to pinned normalized hashes, and expected schema is generated separately from these approved migrations, never learned from the import target. Limits are measured before releasing a plan. The first SQL guard repeats owner/auth/empty/migration/schema/trigger checks inside the transaction.

Permission, no-external-writer, bookmark/retention/recovery, implementation review and disposable proof checks are **simulated attestations only** in this stage. Their true values in `simulationPolicy` are test inputs, not claims that those events occurred. The report always has `remoteEligible=false`, even at 37/37 PASS. Real remote facts remain unverified, and there is no production execution policy. No Time Travel method exists here.

## Generator and rollback

The generated sequence preserves all original IDs/fields and adds owner only to plans/tags: first guard → plans/versions/tags → original tasks in copy dependency layers → joins → temporary task state for log-bearing tasks → original closed logs → original task state restoration → six full-field postconditions → final schema/trigger guard. No trigger is dropped or replaced. Generated SQL contains no transaction commands; the memory SQLite adapter owns BEGIN/COMMIT/ROLLBACK.

Guards produce an actual SQL integer-overflow error when their predicates fail. Postconditions compare counts and every source row field/ID using bound JSON, including NULL, owner and final task fields. JSON content and values never enter SQL text or logs. Local JSON1/UPDATE FROM support is verified; identical remote proxy/D1 support remains a disposable-test gate.

The actual-source dry-run preserves fields, auth state, schema, 17 triggers and FK in memory. Measured output: **17 statements, max 60 binds, max SQL 1,274 bytes, total SQL 6,635 bytes, bound JSON/parameter encoding 65,008 bytes**. Tasks are inserted in two dependency layers, so the actual max is 60 rather than the design's upper estimate 72. Stronger guards increase SQL compared with prior estimates. These are measured offline SQL sizes, not remote transport/body/time measurements. Limits reject >100 binds/query, >100,000 SQL bytes/statement or >50 statements.

## Unknown results and tests

Plans are consumed before the first submission. A failed/unknown submission cannot reuse that plan and is never automatically retried. Classification is read-only: settled empty unchanged state is NOT_EXECUTED; exact source+owner+schema+auth state is COMPLETED; partial/different/in-flight state is UNEXPECTED_PARTIAL_OR_UNKNOWN with human intervention required. A simulated lost response after commit intentionally produces COMPLETED, not a false rollback claim. Local synchronous inspection cannot prove remote requests have settled; future adapters must supply trustworthy termination evidence.

Synthetic tests execute real SQLite transactions/trigger guards, including insert/execution/restore/postcondition failure, silent field corruption and state drift after preflight. Definite failures assert complete business/auth/trigger state equality and no additional batch. Remote access, writer observations and recovery are simulated only. Local import fixtures and all automated browser/API fixtures are not actual diary use or five-day records.

Commands: `npm test`, `npm run typecheck`, `npm run build`, `npm run test:e2e -- --reporter=list`, `npm run test:auth:browser -- --reporter=list`, `node --import tsx scripts/stage3d/local-check.ts`, `node scripts/stage3d/check-privacy.mjs`.

Browser tests automatically rewrote four historical screenshot paths despite the reporter override. Those four files were restored exactly from HEAD; historical evidence is unchanged. Windows sandbox restrictions prevented initial esbuild/tsx startup; final local checks were rerun with approved process permissions, without executing any Cloudflare tooling.

Final checks: 136 existing unit/API + 60 new Stage3D tests + 19 existing browser tests = **215 PASS, 0 FAIL**; existing regression remains 155 PASS. TypeScript and build PASS. The first privacy scan falsely matched its own overly broad PEM detector; the pattern was restricted to actual PEM header characters and rerun. No source-text or credential leak was found in that initial scan.

## Remaining gates

- Claude implementation audit before disposable testing; no commit/push this turn.
- Exact remote proxy atomicity, JSON/SQL support, transport limits and unknown-settled classification require disposable D1 evidence.
- The local guard/schema baseline includes the existing local `_migrations` registry. Remote provisioning uses its own migration registry/schema; future adapter work must explicitly reconcile those names and approved fingerprints. This local plan is not ready to reuse verbatim on remote D1.
- Actual loopback Better Auth + remote adapter, origin/secret transition and proxy access scope are unimplemented.
- Real no-external-writer observations, bookmark retention, restore permission method and separate recovery approval remain UNKNOWN. Restores are forbidden in design/test stages.
- Static privacy checks cover actual source text >=6 characters, prohibited evidence keys and known secret patterns, not every encoding or all possible credential material. Full auth values are kept only in ephemeral fixture memory, never evidence/test output.

Remote Cloudflare requests, remote writes, preview sessions, permanent deploy, real signup/import, Time Travel restore and actual five-day records: **0**.
