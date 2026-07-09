---
name: dev-stack
description: Run, verify, and troubleshoot the TendTo dev stack (Postgres + PowerSync + FastAPI + Vite). Use when starting work, running the app, or when sync/db containers misbehave.
---

# Run the dev stack

## Order matters

1. `cp .env.example .env` (first time only; fill Clerk values when auth work starts)
2. `make db` — starts Postgres (with `wal_level=logical`, required by PowerSync) and the
   PowerSync service (:8080)
3. `make api` — FastAPI on :8000 (needs `pip install -e "apps/api[dev]"` in a venv first time)
4. `make web` — Vite on :5173 (needs `npm install` in `apps/web` first time)

## Verify it's healthy

- `curl localhost:8000/health` → `{"status":"ok"}`
- `docker compose ps` → both containers `running`; powersync logs show sync rules loaded:
  `docker compose logs powersync | tail -20`
- Web: open http://localhost:5173 — must render instantly even with API stopped (local-first).

## Common failures

- **PowerSync can't replicate**: Postgres missing logical replication — confirm the compose
  `command` includes `wal_level=logical`; wipe the volume (`docker compose down -v`) if the DB
  was first created without it.
- **wasm/OPFS errors in browser**: Vite config must keep `wasm()` + `topLevelAwait()` plugins
  and `optimizeDeps.exclude: ["@powersync/web"]`. OPFS needs a secure context — use
  `localhost`, not a LAN IP (or add `--host` + HTTPS).
- **401s from API**: Clerk env vars unset — for pre-auth phases, stub `get_current_user` in
  tests rather than disabling auth in `app/auth.py`.

## Two-device test (the product's core promise)

Laptop browser + phone browser on the same LAN (or a tunnel). Edit on one → appears on the
other in ~1s. Then airplane-mode one device, edit both, reconnect → both converge, no data loss
on different-row edits.
