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
infra/
  powersync/   sync-rules.yaml + service config
docs/
  planning/    strategic plan (source of truth for decisions)
.claude/
  agents/ skills/ memory/   Claude Code harness for this repo
```

## Quick start (dev)

```bash
cp .env.example .env          # fill in values
make db                       # postgres via docker compose
make api                      # FastAPI on :8000
make web                      # Vite dev server on :5173
```

## Current phase

**Phase 0 — prove the sync loop** (see [roadmap](./docs/planning/03-roadmap.md)):
BlockNote → local SQLite → PowerSync → FastAPI → Postgres → second device.
Done means: instant local editing, ~1s cross-device update, airplane-mode merge on reconnect.

## Guiding principle

Every feature must survive the **"does this add clutter?"** test. Speed and calm are features —
and in this architecture, speed is structural.
