---
name: t07-flow
description: Continue or audit the T07 auth diary assignment using the repo handoff files, without requiring long copy-paste between Codex, Claude Code, and ChatGPT.
---

Use this skill for T07 continuation, delta audit, handoff, or checkpoint preparation.

Read:
- AGENTS.md
- handoff/CURRENT.md
- handoff/CODEX-RESULT.md
- handoff/CLAUDE-AUDIT.md

Interpret the first argument when present:
- `audit`: audit only the latest Codex delta. Update CLAUDE-AUDIT.md and CURRENT.md.
- `continue`: perform the next action allowed for Claude by CURRENT.md.
- `status`: report the current stage, blocker, and next action in at most 8 lines.

Audit policy:
- Critical/high: must fix.
- Medium: must fix only if it blocks correctness, security, assignment acceptance, or the next remote step.
- Low: record only.
- Do not repeat old audits.
- Do not modify implementation code during an audit unless the user explicitly asks.

Never perform a remote/prod action unless CURRENT.md explicitly records approval for that exact action.
