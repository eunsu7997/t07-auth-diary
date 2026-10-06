# T07 no-copy-paste workflow

After this handoff setup is merged into the working branch:

## Codex
Usually type only:

`continue T07`

Codex reads AGENTS.md + handoff files, does the next action, and writes CODEX-RESULT.md.

## Claude Code
Usually type:

`/t07-flow audit`

Claude audits only the latest delta and writes CLAUDE-AUDIT.md.

## ChatGPT
Tell ChatGPT:

`T07 continue`

ChatGPT can inspect the GitHub handoff files and latest commits instead of requiring a pasted report.

The repo files are the shared source of truth. Do not relay long reports by hand.
