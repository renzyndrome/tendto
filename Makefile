.PHONY: db db-down api auth web test fmt e2e e2e-stack

db:            ## start dev postgres + powersync
	docker compose up -d

db-down:       ## stop and keep data
	docker compose down

api:           ## run FastAPI dev server
	cd apps/api && uvicorn app.main:app --reload --port 18000

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
