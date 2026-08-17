#!/usr/bin/env bash
# Boot the whole TendTo dev stack in one command, then run Vite in the foreground.
#
# The backend (Postgres + Mongo + PowerSync + better-auth + FastAPI) is started and
# health-checked by scripts/e2e-stack.sh — it is idempotent, so re-running `make dev`
# simply re-attaches to whatever is already up.
#
# Vite runs in the FOREGROUND so you see HMR logs and Ctrl-C stops the dev server.
# The backend boot runs under `setsid`, so auth/api land in their own session and Ctrl-C
# on Vite cannot reach them — they stay up for the next `make dev`. Stop them with
# `make dev-down`.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "✖ .env is missing — run: cp .env.example .env" >&2
  exit 1
fi

if [ ! -x apps/api/.venv/bin/uvicorn ]; then
  echo "✖ apps/api/.venv is missing — run: python3 -m venv apps/api/.venv && apps/api/.venv/bin/pip install -e 'apps/api[dev]'" >&2
  exit 1
fi

if [ ! -d apps/web/node_modules ]; then
  echo "✖ apps/web/node_modules is missing — run: cd apps/web && npm install" >&2
  exit 1
fi

# setsid: put the backend services in their own session so a Ctrl-C aimed at Vite
# (delivered to the terminal's foreground process group) cannot take them down.
setsid --wait bash scripts/e2e-stack.sh

echo "▶ starting web (Vite :15173, foreground — Ctrl-C to stop)"
cd apps/web && exec npm run dev
