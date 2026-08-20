---
name: current-state
description: Where the build is as of 2026-08-17 — what shipped on feat/theming-sharing-reminders, what is deliberately unfinished, and the traps a new session should read first
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

## Shipped on `feat/theming-sharing-reminders`

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
- **Comments & @mentions** on pages and cards — a synced `comments` table whose rows are
  author-owned inside the workspace bucket ([[comments-and-mentions]]).

## Deliberately NOT built (don't "fix" these by accident)

- Labels, per-card checklists, attachments, activity feed — see [[reminders-and-card-fields]] for
  why each is out, and `e2e/item-detail.spec.ts` asserts they stay out.
- **Presence** is the last open Phase-2 feature and needs its own infra pass (an ephemeral
  channel, not synced rows). Comments/@mentions shipped 2026-08-20 — see
  [[comments-and-mentions]].
- Mention notifications of any kind: a mention highlights and nothing more, deliberately.
- Object storage: images are still inline data URLs capped at 5 MB.

## Open items

- **`apps/web/pnpm-lock.yaml` is untracked** while `package-lock.json` is tracked and every
  script uses npm. Pick one; they will drift.
- **The e2e suite is Chromium-only** (`playwright.config.ts`), but Renzy uses Firefox daily. A
  Firefox-only rendering bug (its focus outline on `contenteditable`) shipped and was only found
  by driving Firefox by hand. Consider adding a Firefox project, at least a smoke one.
- **The "Saved" indicator reports that the write RESOLVED, not that the row changed.** That is
  exactly why it lied during the `rowsAffected` bug. If it should be a guarantee rather than a
  hint, it needs to verify the row.
- **Email is unconfigured**: `EMAIL_API_KEY` empty ⇒ invites are created but not delivered, and
  the UI offers a copy-link instead. Set a Resend key to send for real.
- **Notifications are opt-in** and need both the browser grant and the in-app switch; they read
  "Blocked" in headless Chromium, which is correct.
- `eslint` has no flat config, so `npm run lint` fails repo-wide (pre-existing; `make fmt`
  tolerates it with `|| true`).

## Verifying a change

`make dev` (stack + Vite), `make test` (55 API tests + web typecheck), and
`cd apps/web && npx playwright test` (62 e2e). `offline.spec.ts` is occasionally flaky under
load — it is a real cross-device sync timeout, passes on retry, and is unrelated to recent work.

**One-shot tests hide bugs in this codebase.** The autosave defect survived a long time because
every spec typed once and reloaded. When touching persistence, edit twice.
