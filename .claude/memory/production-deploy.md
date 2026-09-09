---
name: production-deploy
description: Four blockers that made the production stack unbootable, found by running docker-compose.prod.yml locally
metadata:
  type: project
---

Booting `docker-compose.prod.yml` on a laptop (2026-09-09, before the first real deploy) found
**four separate blockers**. None was reachable from dev, and each would have surfaced on the VPS
as something unrelated. Worth repeating before any future deploy: the prod stack can be run
locally with a fake `--env-file` and `docker network create dokploy-network`, and doing so is
cheap compared with debugging on the box.

1. **The API could never start.** `app/config.py` located the dev `.env` with
   `Path(__file__).resolve().parents[3]`. In the image the module is at `/app/app/config.py`,
   which has three parents, so this raised `IndexError` at *import* time. Guarded now, and pinned
   by `app/tests/test_config.py` — the test exists because nothing else would have caught it.
2. **`alembic upgrade head` could not run.** The image copied `pyproject.toml` and `app/` but not
   `alembic.ini`, so the documented deploy step exited with "No 'script_location' key found".
   Production would have come up with better-auth's 8 tables and none of the 11 application ones.
   The migrations themselves were always present (they live under `app/migrations`).
3. **PowerSync exited at boot with "postgres query failed".** Its pgwire driver insists on SSL
   unless told otherwise; the bundled Postgres has SSL off. The DEV config had carried
   `sslmode: disable` with a comment since forever — the prod config never got it, on both the
   replication and the storage connection. It is now `!env PS_SSLMODE`, defaulting to `disable`
   for the shipped internal Postgres, so moving to Supabase is `PS_SSLMODE=verify-full` rather
   than a config edit.
4. **`bunx @better-auth/cli migrate` failed inside the auth container.** The CLI pulls
   `better-sqlite3`, whose install script compiles C with node-gyp; `oven/bun:1-slim` has no node,
   python or compiler. The CLI is now a dependency installed with `--ignore-scripts` (Bun's
   `trustedDependencies: []` is NOT enough — the newer Bun in the image ignored it), and the
   documented command is `bunx better-auth migrate --yes`, which needs no network.

**Also easy to miss:** nothing creates the `powersync` publication. `wal_level=logical` alone is
not enough. Without it PowerSync starts, reports healthy, and the app works on each device while
never syncing between them — the only clue is a repeating `PSYNC_S1141` in its logs. It is now
the third command in the deploy doc, with `pg_replication_slots` as the check. See
[[local-dev-setup]] for the dev equivalent of the same trap.

**Prod differs from dev in one deliberate way:** dev keeps PowerSync's bucket storage in MongoDB,
prod keeps it in the same Postgres (supported on PG 14+). So there is no mongo service in prod.
