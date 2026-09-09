.PHONY: dev dev-down db db-down api auth web desktop desktop-build desktop-deps desktop-test test fmt e2e e2e-pwa e2e-stack backup restore

# Bun installs to ~/.bun/bin and rustup to ~/.cargo/bin, and nvm's node lives under a versioned
# directory that only a shell which sourced nvm.sh knows about. make's non-login shell picks up
# none of the three, which reports perfectly good toolchains as missing and makes `make desktop`
# fail deep inside Tauri with "npm: not found". Resolve nvm's default alias here instead.
#
# Only added when npm is not already on PATH, so a shell that did source nvm keeps its choice.
NVM_DEFAULT := $(shell cat $(HOME)/.nvm/alias/default 2>/dev/null)
NVM_BIN := $(if $(NVM_DEFAULT),$(firstword $(wildcard $(HOME)/.nvm/versions/node/v$(NVM_DEFAULT)*/bin)))
NODE_PATH_ENTRY := $(if $(shell command -v npm 2>/dev/null),,$(if $(NVM_BIN),$(NVM_BIN):))
export PATH := $(HOME)/.bun/bin:$(HOME)/.cargo/bin:$(NODE_PATH_ENTRY)$(PATH)

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

desktop:       ## boot the backend stack, then run the Tauri desktop shell (needs `make desktop-deps` once)
	bash scripts/desktop-dev.sh

desktop-build: ## build the desktop installers (.deb + .AppImage) into apps/desktop/src-tauri/target/release/bundle
	cd apps/desktop && npm run build

desktop-test:  ## Rust checks for the desktop shell (needs the toolchain from desktop-deps)
	cd apps/desktop/src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test

desktop-deps:  ## print the one-time system setup the desktop shell needs
	@bash scripts/desktop-deps.sh

test:          ## api tests + web typecheck (runs on the tendto_test DB, never your dev data)
	cd apps/api && .venv/bin/pytest -q
	cd apps/web && npm run typecheck

fmt:           ## format everything
	cd apps/api && .venv/bin/ruff format . && .venv/bin/ruff check --fix .
	cd apps/web && npm run lint --silent || true

e2e-stack:     ## boot the backend stack for E2E (Postgres+Mongo+PowerSync+auth+api)
	bash scripts/e2e-stack.sh

e2e: e2e-stack ## boot the stack, run the Playwright E2E suite, then the PWA suite
	cd apps/web && npm run e2e
	$(MAKE) e2e-pwa

e2e-pwa:       ## PWA suite only: production build + preview, no backend needed
	cd apps/web && npm run e2e:pwa

backup:        ## dump the whole database (app + auth tables) to backups/
	bash scripts/backup.sh

restore:       ## restore a dump into a NAMED scratch db: make restore FILE=... TARGET=...
	bash scripts/restore.sh "$(FILE)" "$(TARGET)" $(REPLACE)
