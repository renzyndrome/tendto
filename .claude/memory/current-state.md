---
name: current-state
description: Where the build is as of 2026-09-09 — Phase 3 is closed (PR #3); what is deliberately unfinished, and the traps a new session should read first
metadata:
  type: project
---

Snapshot for whoever picks this up next. Decisions live in the other memory files; this is
*state* — what exists, what does not, and what will bite you.

## Read these first

[[local-dev-setup]] before running anything, [[theming]] before touching any UI,
[[workspace-creation]] before touching workspaces/sharing, [[reminders-and-card-fields]] before
touching cards, the editor, or autosave. The last one is the densest: it holds the PowerSync and
BlockNote traps that cost the most time.

If the work touches a **synced table**, read [[comments-and-mentions]] (bucket vs permission) and
run the `sync-rules` skill — picking the wrong bucket leaks data irreversibly.
If it touches **AI**, read [[ai-engines]] before anything else.
If it touches **timestamps or a time-of-day test**, read [[replica-timestamps]] first.
If it touches **restores, PowerSync repointing, or RLS**, read [[backup-restore]] and
[[rls-backstop]] — both describe failures that leave the app looking healthy while it is not.

## Shipped

**Phases 0–3 are closed.** Everything below landed on `feat/theming-sharing-reminders` (merged),
and the Phase 3 remainder on `feat/fts-search-and-sync-hardening` (PR #3, open as of 2026-09-09)
— see "Phase 3 remainder" further down. Phase 4 (native shells) is untouched by design.

- **Dev stack**: `make dev` / `make dev-down`; the better-auth CLI's TTY hang is worked around in
  `scripts/e2e-stack.sh`.
- **Tests can no longer wipe dev data** — the API suite runs on its own `tendto_test` database
  and refuses to target `DATABASE_URL`. This was added *after* it destroyed real local content.
- **Theming**: light/dark/system with semantic tokens; BlockNote is driven from our theme.
- **Workspaces**: create, switch, rename, delete (type-to-confirm), members, and a full
  invite → email → accept flow. The server's workspace list is authoritative over the replica.
- **Cards**: assignee picker, due date + optional time, desktop notifications (due reminders +
  Pomodoro), and a Trello-style detail dialog at `/c/$collectionId/i/$itemId` with a rich
  description stored as blocks.
- **Autosave** everywhere, with a visible state and crash-safe localStorage drafts.
- **Calendar**: month grid + a day view you can plot tasks on, spanning every workspace
  ([[calendar-day-view]]).
- **Focus**: a Pomodoro that stops between phases ([[pomodoro-phases]]) plus stats and a garden
  on the first user-private synced table ([[focus-gamification]]).
- **Comments & @mentions** on pages and cards — a synced `comments` table whose rows are
  author-owned inside the workspace bucket ([[comments-and-mentions]]).
- **Presence** — "who else is reading this", polled, on the app's only UNLOGGED (and therefore
  unreplicatable) table ([[presence]]).
- **Interactive AI** — Summarize a page, Ask AI on a selection, streamed. Hand-rolled, because
  BlockNote's AI extension is GPL-3.0-or-paid ([[ai-engines]]).
- **The evening recap is ambient** — a device-local watcher delivers it at a configurable hour
  (default 9pm). Deliberately NOT a server cron ([[ai-engines]]).

## Deliberately NOT built (don't "fix" these by accident)

- Labels, per-card checklists, attachments, activity feed — see [[reminders-and-card-fields]] for
  why each is out, and `e2e/item-detail.spec.ts` asserts they stay out.
- Mention notifications of any kind: a mention highlights and nothing more, deliberately.
- A workspace-wide "who's online" list, last-seen, or idle/away status — presence shows only who
  is on the page you are on, and nothing at all when you're alone ([[presence]]).
- A WebSocket layer. Presence polls on purpose; see [[presence]] before "upgrading" it.
- A server-side cron for the daily recap. The server never learns anyone's timezone, and email
  is unconfigured — see [[ai-engines]] before rebuilding `app/ai/jobs.py`, which was deleted.
- AI in card descriptions, a tone slider, a length dial, "continue writing", or translate
  (translate needs a language picker and should be argued on its own).
- Object storage: images are still inline data URLs capped at 5 MB.

## Open items

**npm is the package manager**, decided 2026-08-21. A stray `pnpm-lock.yaml` sat untracked for
weeks; it was deleted. Every path uses npm — Makefile, `scripts/dev-stack.sh`, README, and
`apps/web/Dockerfile` (so npm is what production builds with). If pnpm is ever wanted it is a
real migration of all four, not a second lockfile.

- **The e2e suite is Chromium-only** (`playwright.config.ts`), but Renzy uses Firefox daily. A
  Firefox-only rendering bug (its focus outline on `contenteditable`) shipped and was only found
  by driving Firefox by hand. Consider adding a Firefox project, at least a smoke one.
- **The AI spend guards are in-process** (`app/ai/limits.py`) and would **fail OPEN** under
  `--workers N` — each worker gets its own allowance. Presence's in-memory registry shards the
  same way but fails closed. The API now REFUSES to boot with several workers unless
  `TENDTO_ALLOW_MULTIPLE_WORKERS=1` (`app/startup_checks.py`), so the failure is loud rather than
  silent — but a shared store is still the real fix before strangers arrive.
- **`codex` as an AI CLI is UNVERIFIED** — no install to test against, so its argv is a guess and
  it does not stream. `claude` and any OpenAI-compatible API are the tested paths.
- **The CLI engine inherits the operator's global Claude Code config**, so SessionStart hooks fire
  and can inject unrelated project context into TendTo's prompts. `--bare` would fix it but
  breaks subscription auth. Dev-only wart; see [[ai-engines]].
- **The "Saved" indicator reports that the write RESOLVED, not that the row changed.** That is
  exactly why it lied during the `rowsAffected` bug. If it should be a guarantee rather than a
  hint, it needs to verify the row.
- **Email is unconfigured**: `EMAIL_API_KEY` empty ⇒ invites are created but not delivered, and
  the UI offers a copy-link instead. Set a Resend key to send for real. This is also the
  precondition for revisiting a server-side recap job.
- **Notifications are opt-in** and need both the browser grant and the in-app switch; they read
  "Blocked" in headless Chromium, which is correct.
- `eslint` has no flat config, so `npm run lint` fails repo-wide (pre-existing; `make fmt`
  tolerates it with `|| true`). `ruff check app/` likewise reports ~37 pre-existing errors in the
  API; new work is expected to be clean, the backlog is not.
- **The dev box runs out of memory on a one-shot `make e2e`** (~2 GB free). The suite was killed
  mid-run and took the backend stack with it. Run it in batches of 8-10 spec files instead.

## Phase 3 remainder — done (PR #3)

All four shipped on `feat/fts-search-and-sync-hardening`. Each carries a trap worth knowing:

- **Instant search** is SQLite FTS5 now, not `LIKE`. `fts_pages`/`fts_items`/`fts_blocks` are
  kept fresh by triggers on PowerSync's internal `ps_data__*` tables, so rows arriving from the
  sync stream are indexed with no JS bookkeeping. A trigger body that throws would abort sync
  apply, so every nested-JSON read in one is guarded. The index is dropped on sign-out.
- **Sync hardening** — an open editor now says "Updated on another device" and offers Reload,
  rather than silently overwriting. It is a notice, never a merge. Detection compares the SET of
  `(id, updated_at)` pairs, and compares them as INSTANTS: the text is not stable across the sync
  round-trip ([[replica-timestamps]]). PowerSync is also re-dialled on `online` and tab focus.
- **Backup/restore** — `make backup` / `make restore`, `docs/backup-restore.md`, drill actually
  run. Restoring Postgres is only half a restore ([[backup-restore]]).
- **RLS** — migration `0008_rls`, enabled but deliberately NOT forced ([[rls-backstop]]). Do not
  add FORCE without doing the three steps in the documented order; it kills sync.

Plus a startup guard: the API refuses `--workers N>1` unless
`TENDTO_ALLOW_MULTIPLE_WORKERS=1`, because the AI spend limits shard per worker and fail OPEN.

## What's next on the roadmap

**Stripe** billing and **pgvector** semantic search (AI-4), both postponed by Renzy on
2026-09-03 — pgvector needs a paid embeddings API the CLI engine cannot provide, and FTS covers
the search need. Then Phase 4 (native shells), untouched by design — see [[desktop-shell-plan]].

Still open from the go-public list: transactional **email** needs a real Resend key, and the AI
spend guards want a shared store rather than the boot-time refusal above.

## Verifying a change

`make dev` (stack + Vite), `make test` (166 API tests + web typecheck), and
`make e2e` (100 Playwright tests across 32 spec files — the per-feature done gate; run it in
batches, see above). **Two specs SKIP when an AI engine
is configured** (`ai-summary`, `recap`) — that is correct, not a failure. To exercise them,
blank `AI_CLI` in `.env` and restart the API.

`offline.spec.ts` was long believed flaky. It ran 5/5 clean with no retries on 2026-09-04, after
PowerSync gained a reconnect nudge on `online`/tab-focus. The flakes actually chased down that
week were something else: two near-midnight date bugs ([[replica-timestamps]]) and the box
running out of memory. **Before blaming a spec, check the clock and `free -g`.**

**Restart the API after touching `TABLE_MODELS`, `DATETIME_COLUMNS` or anything else read at
import**: the e2e stack runs uvicorn without `--reload`. **Restart the PowerSync container after
editing `sync-rules.yaml`**, and expect it to reprocess every bucket for a minute afterwards.

**One-shot tests hide bugs in this codebase.** The autosave defect survived a long time because
every spec typed once and reloaded. When touching persistence, edit twice.

**Never let a test spend the AI subscription.** The e2e suite stubs `/ai/*` with `page.route`;
pytest uses fake providers. Where a spec must hit the real endpoint, it guards with
`aiEngineConfigured()` from `e2e/helpers/api.ts`, which reads `/ai/status` and costs nothing —
the old probe called the recap itself, so the very check meant to avoid spending the
subscription spent one call of it.

## Phase 4 (2026-09-09) — installable PWA + Tauri desktop shell

Branch `feat/fts-search-and-sync-hardening`, on top of the Phase 3 remainder.

- **PWA finished.** Icons generated from `apps/web/public/logo.svg` and committed, manifest fields,
  Apple/theme metas, and our own SW registration (`src/lib/pwa.ts`) with an hourly update check.
  New gate: `make e2e-pwa` (own config; the main suite runs `vite dev`, which has no SW).
  See [[pwa-install]].
- **PowerSync upgraded to 2.x**, pinned as a set to match the alpha Tauri plugin. See
  [[powersync-version-alignment]]. All 99 E2E passed on the new HTTP-streaming default.
- **`apps/desktop` exists** — Tauri 2, Rust-owned SQLite via `tauri-plugin-powersync`, Rust
  connector, tray + close-to-tray + single instance, native notifications. See [[desktop-shell-plan]]
  and `docs/desktop.md`.
- **Auth changed for the shell**: origin allowlists became lists in all three servers, and the
  desktop uses better-auth's `bearer()` plugin. See [[desktop-auth]].
- **New platform seam**: `@powersync-platform` is aliased per Vite mode to `platform.web.ts` or
  `platform.desktop.ts`, both typed against `PowerSyncPlatform`. The browser bundle carries no
  Tauri code and the desktop bundle carries no service worker — both checked by grepping `dist/`.

**New gates:** `make e2e-pwa` and `make desktop-test`. `make desktop-deps` prints the one-time
system setup; it needs a `sudo apt` line, so it is a manual step.

**Still open:** the WebKitGTK editor spike (the go/no-go for the Linux shell), `make desktop-build`
(no release bundle produced yet), plus Stripe and pgvector from earlier phases.
