---
name: dev-stack
description: Run, verify, and troubleshoot the TendTo dev stack (Postgres + PowerSync + FastAPI + better-auth + Vite). Use when starting work, running the app, or when sync/db/auth services misbehave.
---

# Run the dev stack

## Order matters

1. `cp .env.example .env` (first time only; set a real `AUTH_SECRET` when auth work starts)
2. `make db` — starts Postgres (host :15432, with `wal_level=logical`, required by PowerSync)
   and the PowerSync service (host :18080). Dev host ports are deliberately non-default —
   other local docker projects use 5432/8080.
3. `make api` — FastAPI on :18000 (needs `pip install -e "apps/api[dev]"` in a venv first time)
4. `make auth` — better-auth service on :13001, runs on **Bun** (first time: install Bun,
   then `bun install` + `bun run migrate` in `apps/auth`; skippable in pre-auth phases)
5. `make web` — Vite on :15173 (needs `npm install` in `apps/web` first time)

## Verify it's healthy

- `curl localhost:18000/health` → `{"status":"ok"}`
- `docker compose ps` → both containers `running`; powersync logs show sync rules loaded:
  `docker compose logs powersync | tail -20`
- Web: open http://localhost:15173 — must render instantly even with API stopped (local-first).

## Common failures

- **PowerSync can't replicate**: Postgres missing logical replication — confirm the compose
  `command` includes `wal_level=logical`; wipe the volume (`docker compose down -v`) if the DB
  was first created without it.
- **wasm/OPFS errors in browser**: Vite config must keep `wasm()` + `topLevelAwait()` plugins
  and `optimizeDeps.exclude: ["@powersync/web"]`. OPFS needs a secure context — use
  `localhost`, not a LAN IP (or add `--host` + HTTPS).
- **401s from API**: auth service not running or `AUTH_*` env vars unset — for pre-auth phases,
  stub `get_current_user` in tests rather than disabling auth in `app/auth.py`.
- **PowerSync rejects tokens**: its container must reach the auth service's JWKS —
  `extra_hosts: host.docker.internal:host-gateway` in compose, and the `audience` in
  `infra/powersync/config.yaml` must match better-auth's `AUTH_AUDIENCE`.

## Two-device test (the product's core promise)

Laptop browser + phone browser on the same LAN (or a tunnel). Edit on one → appears on the
other in ~1s. Then airplane-mode one device, edit both, reconnect → both converge, no data loss
on different-row edits.
