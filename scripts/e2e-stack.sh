#!/usr/bin/env bash
# Boot the TendTo backend stack for E2E (Postgres + Mongo + PowerSync + better-auth + FastAPI).
# Playwright starts Vite itself. Idempotent: safe to re-run. See docs/e2e.md.
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/.bun/bin:$PATH"
LOGDIR="${TMPDIR:-/tmp}/tendto-e2e"; mkdir -p "$LOGDIR"

echo "▶ docker: db + mongo + powersync"
docker compose up -d db mongo powersync >/dev/null

echo "▶ waiting for Postgres + Mongo health"
for i in $(seq 1 40); do docker compose ps db    | grep -q healthy && break; sleep 1; done
for i in $(seq 1 40); do docker compose ps mongo | grep -q healthy && break; sleep 1; done

echo "▶ migrations: app (alembic) + auth (better-auth)"
( cd apps/api && .venv/bin/alembic upgrade head >/dev/null )
# PowerSync logical-replication publication (ignore if it already exists)
docker compose exec -T db psql -U tendto -d tendto -c \
  "CREATE PUBLICATION powersync FOR ALL TABLES;" >/dev/null 2>&1 || true
# NOTE: the better-auth CLI hangs forever when stderr is a TTY (its progress spinner
# deadlocks and floods the terminal with ANSI redraws). Both streams MUST go to a file —
# redirecting stdout alone is not enough. Keep the log so failures stay diagnosable.
( cd apps/auth && bun --env-file=../../.env x @better-auth/cli@latest migrate --yes \
    >"$LOGDIR/auth-migrate.log" 2>&1 ) \
  || { echo "  ✖ better-auth migrate failed — see $LOGDIR/auth-migrate.log"; exit 1; }

start_if_down() { # name  url  cmd...
  local name="$1" url="$2"; shift 2
  if curl -sf -m 2 "$url" >/dev/null 2>&1; then echo "▶ $name already up"; return; fi
  echo "▶ starting $name"; ( "$@" >"$LOGDIR/$name.log" 2>&1 & )
  for i in $(seq 1 30); do curl -sf -m 2 "$url" >/dev/null 2>&1 && { echo "  $name healthy"; return; }; sleep 1; done
  echo "  ✖ $name did not become healthy — see $LOGDIR/$name.log"; exit 1
}

start_if_down auth http://localhost:13001/health \
  bash -c 'cd apps/auth && exec bun --env-file=../../.env src/index.ts'
start_if_down api  http://localhost:18000/health \
  bash -c 'cd apps/api && exec .venv/bin/uvicorn app.main:app --port 18000'

echo "▶ waiting for PowerSync readiness"
for i in $(seq 1 40); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' -m 2 http://localhost:18080/probes/readiness)" = "200" ] && break; sleep 1
done
echo "✓ backend stack ready (db :15432 · powersync :18080 · auth :13001 · api :18000)"
