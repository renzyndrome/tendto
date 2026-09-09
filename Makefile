.PHONY: dev dev-down db db-down api auth web test fmt e2e e2e-stack backup restore

# Bun installs to ~/.bun/bin, which make's non-login shell does not pick up.
export PATH := $(HOME)/.bun/bin:$(PATH)

dev:           ## boot the whole stack (db+mongo+powersync+auth+api), then Vite in the foreground
	bash scripts/dev-stack.sh

dev-down:      ## stop the background dev services + docker (keeps data)
	bash scripts/dev-down.sh

db:            ## start dev postgres + powersync
	docker compose up -d

db-down:       ## stop and keep data
	docker compose down

api:           ## run FastAPI dev server
	cd apps/api && .venv/bin/uvicorn app.main:app --reload --port 18000

auth:          ## run better-auth service (dev, Bun)
	cd apps/auth && bun run dev

web:           ## run Vite dev server
	cd apps/web && npm run dev

test:          ## api tests + web typecheck (runs on the tendto_test DB, never your dev data)
	cd apps/api && .venv/bin/pytest -q
	cd apps/web && npm run typecheck

fmt:           ## format everything
	cd apps/api && .venv/bin/ruff format . && .venv/bin/ruff check --fix .
	cd apps/web && npm run lint --silent || true

e2e-stack:     ## boot the backend stack for E2E (Postgres+Mongo+PowerSync+auth+api)
	bash scripts/e2e-stack.sh

e2e: e2e-stack ## boot the stack, then run the Playwright E2E suite (Vite auto-starts)
	cd apps/web && npm run e2e

backup:        ## dump the whole database (app + auth tables) to backups/
	bash scripts/backup.sh

restore:       ## restore a dump into a NAMED scratch db: make restore FILE=... TARGET=...
	bash scripts/restore.sh "$(FILE)" "$(TARGET)" $(REPLACE)
