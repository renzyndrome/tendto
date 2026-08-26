---
name: current-state
description: Where the build is as of 2026-08-21 — what shipped on feat/theming-sharing-reminders, what is deliberately unfinished, and the traps a new session should read first
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

## Shipped on `feat/theming-sharing-reminders`

The branch name is two features stale; it now carries everything below. **Phases 0–2 are closed
and Phase 3's headliners are in.**

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

- **`apps/web/pnpm-lock.yaml` is untracked** while `package-lock.json` is tracked and every
  script uses npm. Pick one; they will drift. *(Raised repeatedly and still undecided — it is
  Renzy's call, not a bug to fix unasked.)*
- **The e2e suite is Chromium-only** (`playwright.config.ts`), but Renzy uses Firefox daily. A
  Firefox-only rendering bug (its focus outline on `contenteditable`) shipped and was only found
  by driving Firefox by hand. Consider adding a Firefox project, at least a smoke one.
- **The AI spend guards are in-process** (`app/ai/limits.py`) and **fail OPEN** under
  `--workers N` — each worker would get its own allowance. Presence's in-memory registry has the
  same single-worker assumption but fails closed. Revisit both before strangers can reach the API.
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
  tolerates it with `|| true`).

## What's next on the roadmap

Phase 3's remainder, roughly in the order they'd hurt least to skip: **SQLite FTS** (search is a
`LIKE` match today), **sync hardening** ("updated elsewhere" notices, long-offline reconnects),
the **backup/restore drill**, **RLS hardening**, **pgvector** semantic search (AI-4), and
**Stripe**. Phase 4 (native shells) is untouched by design — see [[desktop-shell-plan]].

## Verifying a change

`make dev` (stack + Vite), `make test` (153 API tests + web typecheck), and
`make e2e` (99 Playwright specs — the per-feature done gate). **Two specs SKIP when an AI engine
is configured** (`ai-summary`, `recap`) — that is correct, not a failure. To exercise them,
blank `AI_CLI` in `.env` and restart the API. `offline.spec.ts` is occasionally
flaky under load — it is a real cross-device sync timeout, passes on retry, and is unrelated to
recent work.

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
