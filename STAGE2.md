# T07 Stage 2 — local implementation notes (not final submission)

Scope: T07 only. Stage 1 commit `91b20dda051e45e88b569acee8053d9267d3bf74` was pushed to `origin/codex/t07-auth`. T06 base `d5a386e343c204a7ed5abb914e54b75e679eb2fd` remains an ancestor. Stage 2 changes currently remain local and uncommitted. `t06-source` push URL remains disabled.

## Ownership

`Diary(db, userId, now?)` requires authenticated identity. Hono obtains it from Better Auth 1.7.7 server-side session lookup. Query, body and identity headers cannot select another user. 18 business method/route combinations are protected; review's plan query is also checked. Unauthenticated requests are 401. Foreign resources and absent resources use the same 404 response per resource kind. Authenticated global plans/review/export return only that user's data.

SQL predicates scope reads, writes and execution retry lookups. An initial resource check is accompanied by owner predicates on writes. Plan/tag owners and task identity cannot change even through direct SQL. Global request ID collisions return a generic conflict without foreign log/task contents. Business aggregate reads and export use one transactional snapshot. Six business tables are exported; authentication tables and hashes/tokens are excluded.

## Migration and data

`0001/0002/0003` are unchanged. `0004_ownership.sql` makes plans/tags ownership NOT NULL with restricted user foreign keys. Tags use UNIQUE(owner_user_id,name); task_tags and copied task links have DB ownership triggers. Other business tables, IDs, history and execution constraints remain intact. Tag length constraint is preserved.

The migration is for a fresh T07 business DB. It refuses nonempty ownerless plans/tags before any table replacement, and rolls back without losing legacy records. It does not arbitrarily assign an existing user's identity. A separately reviewed T06 JSON import into an already initialized T07 DB is still required later; it must preserve IDs and relations explicitly. No actual T06 data was imported. The local constructor closes its SQLite connection if a migration fails.

JSON export is T07 schema 3.0.0 (`contracts/pds-schema-v3.json`). The T06 v2 contract is retained for the later import. UI downloads `t07-diary.json`.

## Verification

Original 61 checks: 47 unit/API + 14 browser. All test bodies/intents retained with safe sessions and test-isolated accounts. Four changed requirements: table correspondence separates auth/business tables; anonymous use now requires 401; anonymous fresh browser rejects data and another logged-in user is isolated; ownerless upgrade is refused without data loss. Migration application is checked by migration identity instead of a fixed old count. Existing execution precision/idempotency, version immutability, copy rollback, soft-delete, filtering, review and export relationships remain checked. Mobile gets its own plan instead of relying on prior tests.

New tests: 13 authentication unit/API + 4 authentication browser + 48 ownership tests. A/B each includes the requested 20 categories, missing-vs-foreign parity and request-ID collisions. Rejected operations compare fingerprints of all six business tables. DB constraints and anonymous routes are also checked. Fingerprints are compared as booleans and no authentication rows are snapshotted.

Commands: `npm run typecheck`, `npm run build`, `npm test -- --reporter=json --outputFile=evidence/t07/stage2/unit-results.json`, `npm run test:e2e`, `npm run test:auth:browser`.

Local Worker verification: `wrangler d1 migrations apply aleph-t07-auth-diary-db --local`; `wrangler dev --local --ip 127.0.0.1 --port 8787 --local-protocol https`; `node scripts/verify-local-ownership-worker.mjs`. This separately checks 60 assertions against actual workerd/local D1, including bilateral refusals and DB fingerprint invariance. These assertions are reported separately from test totals. Temporary local D1 fixtures are ignored, explicitly not real usage.

The first browser attempt encountered Better Auth's production rate limiter during rapid fixture signups. The isolated temporary e2e server now runs NODE_ENV=test, while the production bundle and CSP still apply. Application auth configuration and production default rate limiting were not weakened. The first attempt report is retained, and the final report is separate. A wrong button selector and a mobile fixture dependency were also corrected. Playwright trace/video/password screenshots are disabled. The TLS verifier disables certificate verification only for its fixed HTTPS localhost endpoint.

Evidence in `evidence/t07/stage2`: final JSON reports, initial attempt report, safe screenshots, summary and secret-check. `node scripts/check-stage2-secrets.mjs` checks known local secrets, stored credentials/session values against public files and the bundle; it cannot certify unknown historical secrets or arbitrary personal text.

## Remaining

Independent Claude Code audit has not run. Remote T07 D1 provisioning, migration, public deployment, real T06 JSON import, real five-day usage, Day 2 rule change and final submission documents have not run. Workers distributed rate limiting and deployment-specific secrets/origins remain items for the deployment/security audit. No T06 working tree, remote, Worker or operating DB was changed.
