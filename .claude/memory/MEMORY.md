# TendTo project memory — index

One line per memory. Full content in the linked files; keep this index lean.

- [Current state](current-state.md) — **start here**: what shipped on the current branch, what is deliberately unbuilt, open items

- [Architecture decision: sync-engine local-first](architecture-decision.md) — why PowerSync over cloud-first and over Yjs; the exit ramps
- [Naming & domain](naming-and-domain.md) — TendTo; tendto.app taken, expiry watch Nov 2026; interim domain candidates
- [Settled stack decisions](settled-decisions.md) — do-not-relitigate list with one-line whys
- [Auth & sync redesign](auth-and-sync-redesign.md) — Clerk → better-auth (scale pricing); PowerSync kept (only engine passing offline); JWKS wiring
- [Phase 1 build](phase-1-build.md) — what shipped in the MVP; block-id=BlockNote string, /bootstrap chicken/egg, cross-tenant pin, editor hydrate/persist, pinned web versions
- [Desktop shell plan](desktop-shell-plan.md) — Rust via Tauri 2 + first-party PowerSync Tauri plugin (alpha); never @powersync/web in a webview; WebKitGTK is the risk
- [Local dev setup](local-dev-setup.md) — fresh-machine traps: better-auth CLI hangs on a TTY, venv at apps/api/.venv, the PowerSync publication no migration creates, `make test` wipes the dev DB
- [Theming](theming.md) — semantic colour tokens (never name a shade, never `dark:`); BlockNote must be handed our resolved theme or it follows the OS on its own
- [Workspace creation](workspace-creation.md) — why it needs POST /workspaces instead of a local write; the concurrent-/bootstrap race that produced duplicate "My Workspace" rows
- [Reminders & card fields](reminders-and-card-fields.md) — due date+optional time format, assignee picker, and why due reminders are device-local, coalesced and opt-in
- [AI engines](ai-engines.md) — CLI (claude/codex) vs API vs fallback; why CLI is dev-only, the stdin/scratch-dir containment, and the e2e no-engine contract
- [Focus gamification](focus-gamification.md) — reflective stats + a garden that never punishes; the first user-private sync bucket, and the timestamp bind that wedges upload queues
- [Pomodoro phases](pomodoro-phases.md) — why the timer stops between phases (Auto is opt-in), and the StrictMode double-fire that skipped a whole phase
- [Calendar day view](calendar-day-view.md) — items are deadlines not meetings (one-slot blocks, no duration); the all-day row IS "no time"; which Google behaviours were dropped
