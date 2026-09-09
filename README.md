# TendTo

> Tend to your tasks, notes, and life. A focused, clutter-free, local-first workspace —
> **instant like Obsidian, synced everywhere like Notion**.

## Architecture in one line

**Local-first reads** (SQLite replica on every device, via PowerSync) + **authoritative writes**
(FastAPI validates everything into Postgres) + **a bought sync engine** in between.

Full plan: [docs/planning/](./docs/planning/) — start with
[07 — Stack & Build Path](./docs/planning/07-stack-and-roadmap.md).

## Repo layout

```
apps/
  web/     Vite + React 19 + TS SPA (installable PWA) — BlockNote editor, PowerSync client, TanStack Router
  desktop/ Tauri 2 shell — native SQLite replica owned by Rust, tray, native notifications
  api/     FastAPI — the authoritative write path (sync upload), permissions, AI endpoints
  auth/    better-auth on Hono + Bun — sessions, orgs/invites, JWT + JWKS (infra, not product code)
infra/
  powersync/   sync-rules.yaml + service config
docs/
  planning/    strategic plan (source of truth for decisions)
.claude/
  agents/ skills/ memory/   Claude Code harness for this repo
```

## Quick start (dev)

First time only:

```bash
cp .env.example .env                                   # fill in values
python3 -m venv apps/api/.venv                         # the scripts expect the venv HERE
apps/api/.venv/bin/pip install -e "apps/api[dev]"
curl -fsSL https://bun.sh/install | bash               # apps/auth runs on Bun
(cd apps/auth && bun install)
(cd apps/web  && npm install)
```

Then, every day:

```bash
make dev        # boots db+mongo+powersync+auth+api, runs migrations, then Vite in the foreground
                # Ctrl-C stops Vite only; the backend stays up for the next `make dev` (~3s)
make dev-down   # stop the backend + docker (keeps data)
```

Individual pieces, if you'd rather run them in separate terminals:

```bash
make db                       # postgres (:15432) + powersync (:18080) via docker compose
make api                      # FastAPI on :18000
make auth                     # better-auth service on :13001
make web                      # Vite dev server on :15173
```

## Deploy

One Dokploy Compose service from `docker-compose.prod.yml` (Postgres + PowerSync + auth + API
+ static web). See [docs/deploy-dokploy.md](./docs/deploy-dokploy.md).

## Testing

```bash
make test          # API tests (pytest) + web typecheck
make e2e           # boots the whole stack, then the Playwright suite — the per-feature "done gate"
make e2e-pwa       # the installable-PWA suite alone (production build, no backend needed)
make desktop-test  # Rust checks for the desktop shell (fmt, clippy, unit tests)
```

`make test` runs against a dedicated `tendto_test` database and **refuses** to target the one in
`DATABASE_URL` — the suite truncates every table, and it once destroyed real local content.

## Current phase

**Phases 0–3 are largely shipped** (see [roadmap](./docs/planning/03-roadmap.md)):

- **Sync loop** — BlockNote → local SQLite → PowerSync → FastAPI → Postgres → second device,
  including the airplane-mode merge.
- **MVP** — accounts, nested pages, the curated block editor, installable PWA.
- **Collections** — one `items` primitive as checklist / list / table / kanban, plus a card
  detail dialog with a rich description, assignee and due date + optional time.
- **Shared workspaces** — multiple workspaces, members and roles, invitations by email.
- **Organize + intelligence** — unified calendar (month grid + a day view you can plot tasks on,
  spanning every workspace), instant search, export, and a **Daily recap** — the AI summary with
  due-aware recommendations, powered by your local `claude`/`codex` CLI, any OpenAI-compatible
  API, or an offline fallback (`AI_CLI` / `AI_API_KEY` in `.env`).
- **Focus** — a Pomodoro timer that waits for you between phases, with a garden, a consistency
  heatmap and your peak hours built from synced session history.
- **Comments & @mentions** on pages and cards. A mention highlights and does nothing else — no
  notification, no inbox.
- **Presence** — who else is reading the page you are on, and nothing at all when you are alone.
- **Interactive AI** — per-page Summarize and inline Ask AI (improve / shorten / fix), streamed
  as it is written. Nothing touches the document until you press Keep.
- **The recap is ambient** — it arrives each evening at a time you choose (9pm by default).
- Plus light/dark theming and opt-in due/Pomodoro reminders.

**Phases 0–3 are closed**, including ranked FTS5 search, the RLS backstop and the backup/restore
drill. **Phase 4 has started**: the PWA is installable on a phone (icons, manifest, offline cold
boot — see [docs/deploy-dokploy.md](./docs/deploy-dokploy.md) for the Android checklist), and a
Tauri desktop shell lives in `apps/desktop` with the replica moved into Rust-owned native SQLite
(see [docs/desktop.md](./docs/desktop.md); it needs one `sudo apt` line via `make desktop-deps`,
and the editor still has to be exercised on WebKitGTK before the shell is trusted for daily work).
Still open: Stripe and pgvector semantic search.

> Running build state, open engineering items and the traps worth knowing before you touch the
> editor or sync live in [`.claude/memory/`](./.claude/memory/) — start with `current-state.md`.

## Guiding principle

Every feature must survive the **"does this add clutter?"** test. Speed and calm are features —
and in this architecture, speed is structural.
