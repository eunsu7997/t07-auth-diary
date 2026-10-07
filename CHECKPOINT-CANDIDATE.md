# Local checkpoint candidate — NEEDS_AUDIT

No files have been staged, committed, pushed, restored, deleted or stashed for this checkpoint. These lists describe pending diffs against HEAD; the held work remains intact. A future checkpoint requires Claude audit and explicit user approval. Do not use `git add .`.

## Include candidates

Current audit fixes:

- migrations/0006_account_deletion.sql
- src/server/account-deletion.ts
- src/server/app.ts
- src/client/AccountDeletionForm.tsx
- src/client/AuthGate.tsx
- tests/account-deletion.test.ts
- tests/historical-import-schema.ts
- tests/import-stage3d.test.ts
- tests/import-stage3e1.test.ts
- tests/import-stage3e2a.test.ts
- README.md
- STAGE2-1.md
- DEPLOYMENT.md
- T07-CARD-CHECK.md
- CHECKPOINT-CANDIDATE.md
- handoff/CURRENT.md
- handoff/CODEX-RESULT.md

Previously pending card/protection fixes and independent audit record, retained for the same candidate:

- scripts/stage3e2a/transport.ts
- scripts/production-protection.json
- src/client/SeePanel.tsx
- src/client/five-day-summary.ts
- tests/five-day-summary.test.ts
- tests/production-protection.test.ts
- handoff/CLAUDE-AUDIT.md (Claude-authored; not edited by this task)

## Hold / exclude

- scripts/capability/disposable-execution.ts
- scripts/capability/disposable-protocol.ts
- scripts/capability/disposable-runner.mjs
- tests/disposable-execution.test.ts
- evidence/t07/disposable-remote-preflight/result.json
- evidence/t07/capability-local/DISPOSABLE-EXECUTION.md
- scripts/t07-auto.ps1
- scripts/t07-auto.test.ps1
- handoff/T07-AUTO.md
- handoff/AUTO-POLICY.json
- handoff/.t07-auto.lock
- scripts/check-capability-privacy.mjs (hold its entire pending delta)
- evidence/t07/capability-local/privacy-check.json (hold its entire pending delta)
- AGENTS.md
- CLAUDE.md
- .claude/skills/t07-flow/SKILL.md

Ignored .data verification copies/logs and node_modules/dist are not checkpoint candidates. The standalone candidate test copy omits held untracked files and uses HEAD content for held tracked files, without altering the original worktree or index.

## Schema compatibility boundary

0006 is local-only and has not been remotely applied. Existing import safety code remains pinned to the audited 0001–0005 migration bytes. It must reject the new full schema with MIGRATION_HASH_MISMATCH; no new import approval is inferred from C134 tests.

The three historical import suites use an isolated test-module filesystem view of 0001–0005, preserving every old assertion and original migration hash. No tests are removed, and runtime code does not load this fixture. The full-schema C134 suite independently tests 0006 and checks that the actual unmocked importer rejects it. Any future remote-schema/import baseline update requires separate review and approval.

Next: C134 + 문서 + checkpoint 정리 Claude 독립 감사.
