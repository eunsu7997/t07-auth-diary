# T07 shared agent instructions

This file is the shared operating guide for Codex and Claude Code.

## Start every task here
1. Read `handoff/CURRENT.md`.
2. Read the latest relevant `handoff/CODEX-RESULT.md` and `handoff/CLAUDE-AUDIT.md`.
3. Work only on the single next action in `CURRENT.md`.
4. Do not ask the user to copy long status reports between tools. Write handoff results into the repo instead.

## Speed mode
- Optimize for finishing the assignment, not production-grade over-engineering.
- Critical/high findings: must fix.
- Medium findings: fix only when they affect correctness, security, assignment acceptance, or the next remote step.
- Low findings: record and continue.
- One narrow audit per step by default. Repeat only for a remaining must-fix issue.
- Keep prompts, reports, and evidence concise.

## Codex role
- Implement the next action from `handoff/CURRENT.md`.
- Preserve T06 history and T07 safety constraints.
- Run only the tests needed for the changed area plus required regression checks.
- At the end, update `handoff/CODEX-RESULT.md` and `handoff/CURRENT.md`.
- Do not make the user relay the result manually.

## Claude Code role
- Audit only the latest delta described in `handoff/CODEX-RESULT.md`.
- Do not repeat old audits unless the changed code invalidates them.
- Write the result to `handoff/CLAUDE-AUDIT.md` and update `handoff/CURRENT.md`.
- Keep the audit focused on blockers for the next step.

## Remote safety
- Production T07 remote DB access, production deploy, real import, and destructive operations are forbidden unless `handoff/CURRENT.md` explicitly records user approval for that exact action.
- Disposable D1 actions are allowed only when `CURRENT.md` explicitly marks them approved.
- Never expose passwords, cookies, session tokens, API tokens, production DB IDs, or actual diary text in logs/evidence.
- No automatic retry after an unknown remote write outcome.

## Git
- T06 final commit must remain an ancestor.
- `t06-source` push must remain blocked.
- Do not commit/push unless `CURRENT.md` explicitly says the checkpoint is ready.
- Before commit: tests, TypeScript, build, privacy check, and `git diff --check` as applicable.

## Handoff statuses
Use one of:
- IMPLEMENTING
- NEEDS_AUDIT
- AUDIT_FIX_REQUIRED
- AUDIT_PASS
- READY_FOR_CHECKPOINT
- READY_FOR_REMOTE_TEST
- BLOCKED

The user should normally be able to type only “continue T07” or, in Claude Code, run `/t07-flow audit`.
