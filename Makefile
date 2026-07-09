.PHONY: db db-down api web test fmt

db:            ## start dev postgres + powersync
	docker compose up -d

db-down:       ## stop and keep data
	docker compose down

api:           ## run FastAPI dev server
	cd apps/api && uvicorn app.main:app --reload --port 8000

web:           ## run Vite dev server
	cd apps/web && npm run dev

test:          ## api tests + web typecheck
	cd apps/api && pytest -q
	cd apps/web && npm run typecheck

fmt:           ## format everything
	cd apps/api && ruff format . && ruff check --fix .
	cd apps/web && npm run lint --silent || true
