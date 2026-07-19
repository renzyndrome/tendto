.PHONY: dev db db-down api auth web test fmt e2e e2e-stack

# Prefer the api venv's uvicorn if present so `make api`/`make dev` work without activating it.
UVICORN := $(if $(wildcard apps/api/.venv/bin/uvicorn),.venv/bin/uvicorn,uvicorn)

dev: db        ## start the WHOLE dev stack: db+powersync (docker) + auth + api + web (Ctrl+C stops all)
	@echo "TendTo dev → auth :13001 · api :18000 · web :15173   (Ctrl+C stops all)"
	@trap 'kill 0' EXIT; \
		( cd apps/auth && bun dev ) & \
		( cd apps/api && $(UVICORN) app.main:app --reload --port 18000 ) & \
		( cd apps/web && npm run dev ) & \
		wait

db:            ## start dev postgres + powersync
	docker compose up -d

db-down:       ## stop and keep data
	docker compose down

api:           ## run FastAPI dev server
	cd apps/api && $(UVICORN) app.main:app --reload --port 18000

auth:          ## run better-auth service (dev, Bun)
	cd apps/auth && bun dev

web:           ## run Vite dev server
	cd apps/web && npm run dev

test:          ## api tests + web typecheck
	cd apps/api && pytest -q
	cd apps/web && npm run typecheck

fmt:           ## format everything
	cd apps/api && ruff format . && ruff check --fix .
	cd apps/web && npm run lint --silent || true

e2e-stack:     ## boot the backend stack for E2E (Postgres+Mongo+PowerSync+auth+api)
	bash scripts/e2e-stack.sh

e2e: e2e-stack ## boot the stack, then run the Playwright E2E suite (Vite auto-starts)
	cd apps/web && npm run e2e
