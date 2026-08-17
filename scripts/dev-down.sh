#!/usr/bin/env bash
# Stop the background dev services started by scripts/dev-stack.sh.
# Vite is not covered here — it runs in the foreground and stops with Ctrl-C.
# Docker volumes are kept (same as `make db-down`), so no data is lost.
set -uo pipefail
cd "$(dirname "$0")/.."

echo "▶ stopping api (:18000)"
pkill -f 'uvicorn app.main:app --port 18000' || true

echo "▶ stopping auth (:13001)"
pkill -f 'bun --env-file=../../.env src/index.ts' || true

echo "▶ stopping docker (db + mongo + powersync), keeping volumes"
docker compose down

echo "✓ dev stack stopped"
