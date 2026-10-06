# Latest Claude Audit

Status: AUDIT_PASS (design only; conditions below carry into implementation)

Scope: `evidence/t07/capability-design/DESIGN.md` + handoff updates only (uncommitted, on top of `9503be6`).
Not re-audited: prior 269-PASS implementation delta. No tests run (document-only delta; none claimed).

## Critical/high findings
- None.

## Medium findings (must be addressed in the implementation step, not a design re-audit)
- D-1 Observation/write separation — runner allowlist binds host/path/query only. D1 `/query` is a POST that can execute writes, so path allowlisting alone does not make a session read-only. Bind HTTP method + exact body (fixed query registry SQL text/hash, no string-built SQL, no mutating PRAGMA) per operation; add a test that an observation lease cannot send a mutating statement through the read path.
- D-2 Trust-root consistency — design rejects "save fetch at import time" yet the parent supervisor relies on in-process `node:child_process`/streams, which are equally patchable before load (a forged ChildProcess could emit success JSON). State explicitly that in-process code is in the trusted base (threat = accidental/test injection mislabeling origin, not hostile in-process code), and keep the guarantee that only the real runner kind can yield REMOTE_CONTROL_PLANE; fake/test runners must be structurally unable to (no caller-supplied runner kind). Spawn with `spawn(process.execPath, [fixedEntry], { env: <allowlist>, shell:false })`, not `fork` (inherits execArgv); use an env allowlist rather than a denylist (covers NODE_EXTRA_CA_CERTS, SSL_CERT_FILE, NODE_USE_ENV_PROXY/HTTPS_PROXY, NODE_TLS_REJECT_UNAUTHORIZED, --use-system-ca etc.).
- D-3 Bootstrap ordering — §3 says unreadable restore policy => UNKNOWN, and §4.5 requires permission policy confirmed before TEST_RECOVERY. If the policy read fails, the probe that would empirically resolve it is blocked (soft circularity). Specify: on an approved disposable only, policy UNKNOWN does not block TEST_RECOVERY; probe success proves restore for that credential + disposable only and never upgrades production policy evidence.

## Low notes (record only)
- §5 "gate permits some unknowns if the approval doc says so": type accepted unknowns as ACCEPTED_RISK, never as PASS/REMOTE_OBSERVED.
- 30s control-plane freshness vs 10s timeout + pagination: ensure freshness is measured from receipt completion, and multi-page reads fail closed if they exceed it.
- Retention 7-day floor is documentation-derived; fine as labeled. Keep it out of REMOTE_OBSERVED fields.

## Checked OK
- No global fetch / caller-injected transport; origin derived from runner kind; FAKE_CONTROL_PLANE cannot create remote approval.
- Bootstrap steps 1→7 otherwise non-circular; INITIALIZE/TEST_RECOVERY are separate one-time purposes and cannot be used for IMPORT or production.
- Human writer confirmation and doc-derived retention kept distinct from remote observation; empty inventory ≠ false.
- Production denylist at every stage; production T07 not added to disposable path.
- No secrets/IDs/diary text in the design document.

## Decisions
- Design: PASS with D-1..D-3 folded into implementation.
- Local implementation of design §4 step 1 (zero remote I/O): may proceed.
- Checkpoint commit of this design delta: optional, not required.
- Disposable D1 create/test, Cloudflare/D1/proxy access: NO.
- Production T07 remote access / real import / deploy: FORBIDDEN.
