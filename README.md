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
  web/    Vite + React 19 + TS SPA (PWA) — BlockNote editor, PowerSync client, TanStack Router
  api/    FastAPI — the authoritative write path (sync upload), permissions, scheduled jobs
  auth/   better-auth on Hono + Bun — sessions, orgs/invites, JWT + JWKS (infra, not product code)
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

## Current phase

**Phase 0 — prove the sync loop** (see [roadmap](./docs/planning/03-roadmap.md)):
BlockNote → local SQLite → PowerSync → FastAPI → Postgres → second device.
Done means: instant local editing, ~1s cross-device update, airplane-mode merge on reconnect.

## Guiding principle

Every feature must survive the **"does this add clutter?"** test. Speed and calm are features —
and in this architecture, speed is structural.
