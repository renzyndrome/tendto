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
- [AI engines](ai-engines.md) — CLI (claude/codex) vs API vs fallback; why CLI is dev-only; the interactive tier, and why BlockNote's AI extension is unusable (GPL/paid)
- [Focus gamification](focus-gamification.md) — reflective stats + a garden that never punishes; the first user-private sync bucket, and the timestamp bind that wedges upload queues
- [Pomodoro phases](pomodoro-phases.md) — why the timer stops between phases (Auto is opt-in), and the StrictMode double-fire that skipped a whole phase
- [Presence](presence.md) — why polling beat a WebSocket here; UNLOGGED as a structural "this can never sync"; renders nothing when you're alone
- [Comments & @mentions](comments-and-mentions.md) — the bucket decides who reads, the upload path who writes; inline mention tokens; why "(edited)" can't be derived from timestamps
- [Calendar day view](calendar-day-view.md) — items are deadlines not meetings (one-slot blocks, no duration); the all-day row IS "no time"; which Google behaviours were dropped
- [Replica timestamps & the midnight trap](replica-timestamps.md) — `updated_at` text changes across the sync round-trip (compare instants); time-of-day specs that break near midnight
- [Backup & restore](backup-restore.md) — restoring Postgres is only half a restore: PowerSync's bucket storage must be wiped or replication is silently dead
- [RLS backstop](rls-backstop.md) — installed but NOT forced (the owner bypasses); the ordered steps to make it bind, and the policy-recursion trap
- [PWA install](pwa-install.md) — icons committed not built (sharp in Docker), our own SW registration for the hourly update check, and why the PWA E2E needs its own config
- [PowerSync version alignment](powersync-version-alignment.md) — the four JS packages are pinned as a set by the alpha Tauri plugin; two copies of @powersync/common break Schema at runtime
- [Desktop auth](desktop-auth.md) — the tauri:// origin cannot use the session cookie; bearer token held by Rust, origin allowlists became lists, and the camelCase-vs-snake_case trap that fails silently
- [Production deploy](production-deploy.md) — four blockers that made docker-compose.prod.yml unbootable, plus the publication nothing creates; run the prod stack locally before deploying
