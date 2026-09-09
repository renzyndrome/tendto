---
name: local-dev-setup
description: Non-obvious prerequisites and traps when bringing the dev stack up on a fresh machine — better-auth CLI hangs on a TTY, venv location, PowerSync publication
metadata:
  type: project
---

Recorded 2026-08-04 while getting the stack running from scratch. The traps, not the steps —
`scripts/dev-stack.sh` / `scripts/e2e-stack.sh` are the executable version.

- **The better-auth CLI hangs forever when stderr is a TTY.** `bun x @better-auth/cli migrate`
  deadlocks on its progress spinner and floods the terminal with ANSI redraws (475 MB of
  `ESC[1A ESC[0K` in ~60s of real time). Redirecting **stdout alone is not enough** — this is
  why `e2e-stack.sh` sends both streams to `$LOGDIR/auth-migrate.log`. Headless it finishes in
  ~1.6s, so this is invisible in CI and only bites a human in a terminal. Do not "clean up"
  that redirect.
- **The venv lives at `apps/api/.venv`, not the repo root.** `e2e-stack.sh` hardcodes
  `.venv/bin/alembic` relative to `apps/api`. The Makefile targets call `.venv/bin/…`
  explicitly rather than assuming an activated venv, so `make api` / `make test` / `make fmt`
  work from a cold shell.
- **PowerSync needs `CREATE PUBLICATION powersync FOR ALL TABLES` — it is not in any migration.**
  Without it the service loops on `PSYNC_S1141` and replicates nothing, while still answering
  200 on `/probes/readiness`'s port. Readiness alone is not proof sync works; check
  `docker compose logs powersync` for `Replicating "public"."<table>"` lines. The publication
  lives in the docker volume, so `docker compose down -v` silently un-does it.
- **Changing `AUTH_SECRET` silently bricks sign-in until you clear the `jwks` table.**
  better-auth encrypts the JWKS *private* key with `AUTH_SECRET` at rest. The keypair is
  created lazily on the first `/api/auth/jwks` or `/api/auth/token` hit — so rotating the
  secret after the service has served even one request orphans it. Symptom is deceptive:
  signup and sign-in both return 200 and the user row is written, but minting the JWT throws
  `Failed to decrypt private key`, so the app never gets a session. Fix: `delete from jwks;`
  and restart auth — it regenerates under the current secret. Password hashes are scrypt and
  are NOT secret-encrypted, so existing accounts survive. Sessions signed with the old secret
  do not.
- **Bun installs to `~/.bun/bin` and is added to `~/.bash_profile`**, which make's non-login
  shell never sources. The Makefile exports `PATH := $(HOME)/.bun/bin:$(PATH)` for this reason.
- **`make dev` runs the backend boot under `setsid`** so a Ctrl-C aimed at Vite (delivered to
  the terminal's foreground process group) cannot reach auth/api. Verified: after SIGINT only
  :15173 drops; db/powersync/auth/api stay up and the next `make dev` re-attaches in ~3s.
- **The API suite is destructive and now runs on its own database (`tendto_test`).** It used to
  default to `DATABASE_URL` — the dev database — and `conftest._prepare_db` is autouse and wipes
  every table in `Base.metadata` before EACH test, so a routine `make test` destroyed local
  workspaces/pages/blocks. It cost real user data before this was fixed. Now:
  `TEST_DATABASE_URL` defaults to the dev connection with the database name swapped for
  `tendto_test`, conftest creates that database on demand, and `assert_safe_test_database()`
  raises at import if the target matches `DATABASE_URL` (override only with
  `TENDTO_TEST_ALLOW_DEV_DB=1`). Do not "simplify" that guard away.
  Note better-auth's tables (`user`, `session`, `account`, `jwks`) are outside `Base.metadata`,
  so the test DB creates a minimal `"user"` table itself (`AUTH_USER_DDL`) — member listing and
  invite acceptance read it.
- **Sign-out must CLEAR the replica, not just disconnect.** It used to call `db.disconnect()`,
  which leaves the previous account's local SQLite in place: the next person to sign in on that
  device inherits it, and rows deleted server-side never disappear (a signed-out client receives
  no bucket updates, so nothing tells it to drop them). That is how a workspace truncated by
  `make test` kept showing in the switcher as a phantom duplicate. Now `disconnectAndClearDb()`.
- **`page.request.post(/sign-up)` fails in Playwright when the page already has a session** —
  better-auth refuses to register a new user on an authenticated request. Create each extra
  account from its own `browser.newContext()`, which also gives it the session it needs.
- **Editing `tailwind.config.js` requires restarting the Vite dev server.** PostCSS loads the
  Tailwind config once at startup, so new theme colours 500 with "The `bg-x` class does not
  exist" in dev while `vite build` succeeds from a clean process. A green production build is
  not evidence that a running dev server is healthy.

Unrelated-but-adjacent: `apps/web` has BOTH `package-lock.json` (tracked) and `pnpm-lock.yaml`
(untracked); every script uses npm. Pick one before the two drift. See [[phase-1-build]].

**`bunx @better-auth/cli migrate` fails with `node-gyp: command not found`** when node is not on
PATH — it builds `better-sqlite3` natively. With nvm, `source "$NVM_DIR/nvm.sh"` before
`scripts/e2e-stack.sh` (or any `make` target that reaches the auth migration). The Makefile only
prepends `~/.bun/bin`, so a non-login shell hits this every time. Same trap breaks `make desktop`,
where Tauri shells out to `npm`.

