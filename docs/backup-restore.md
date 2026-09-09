# Backup and restore

A backup you have never restored is not a backup. This page is the runbook **and** the record of
the drill actually being run.

## The one thing to know first

**One Postgres database holds everything.** App tables and better-auth's tables (`user`,
`session`, `organization`, the JWKS keys) live side by side, because `AUTH_DATABASE_URL` points
at the same database as `DATABASE_URL`. Restoring only the app half would give you content whose
every `user_id`, membership and invitation referred to people who no longer exist.

So: **always dump the whole database.** `scripts/backup.sh` gives you no way not to.

PowerSync's own storage is MongoDB, and it is a *cache*, not a source of truth. It is deliberately
not backed up. But it is **not** self-healing either — see the next section, which is the part of
this runbook you cannot skip.

## Take a backup

```bash
make backup
```

Writes `backups/tendto-YYYYMMDD-HHMMSS.dump` (`pg_dump -Fc`, the custom format). `backups/` is
git-ignored: dumps are real user content and must never be committed.

The script dumps **inside the `db` container**, whose client tools match the server version, and
then verifies the archive with the host's `pg_restore -l`. A dump that cannot be read back is
renamed `.corrupt` and reported as a failure, because an unreadable file that looks like a backup
is worse than no file at all.

## Restore

```bash
make restore FILE=backups/tendto-20260904-011925.dump TARGET=tendto_restore_check
# add REPLACE=--replace to drop and recreate an existing target
```

The target database is **always explicit**, and restoring over the database in `DATABASE_URL` is
refused outright. (The API test suite once pointed at the dev database and destroyed real local
content; a restore is the one command here that can do that damage in a single keystroke.)

### Recovering for real

Restore to a scratch name, check it, then swap by hand:

```bash
make restore FILE=<dump> TARGET=tendto_new
# stop the API, auth and PowerSync first — a rename needs no other session connected
docker compose exec -T db psql postgresql://tendto:tendto@db:5432/postgres \
  -c 'ALTER DATABASE tendto RENAME TO tendto_old'
docker compose exec -T db psql postgresql://tendto:tendto@db:5432/postgres \
  -c 'ALTER DATABASE tendto_new RENAME TO tendto'
```

Then reset PowerSync's bucket storage — **not** just restart it. See the next section; skipping
it leaves replication permanently dead while the app still looks fine.

Keep `tendto_old` until you are satisfied. Renaming is instant and reversible; dropping is not.

### Restarting PowerSync is NOT enough — wipe its storage

This is the step the drill existed to find, and the one that will cost you an afternoon if you
skip it.

PowerSync records in its MongoDB storage that it has already completed initial replication, and
which Postgres **replication slot** it owns. A restored database has no such slot. Point PowerSync
at one and it decides it is already up to date, then fails forever trying to resume:

```
[powersync_3_1692] Initial replication already done
[powersync_3_1692] Replication error replication slot "powersync_3_1692" was not created in this database
```

Nothing replicates. The app still *looks* alive — sign-in works, local search works, a client's
own private bucket syncs — so it is easy to believe the restore succeeded. Every cross-device
test fails, because no workspace content ever reaches any client.

So after restoring, **reset the bucket storage**:

```bash
docker compose stop powersync mongo
docker compose rm -f mongo
docker volume rm $(docker volume ls -q | grep mongodata)
docker compose up -d mongo powersync      # or just re-run scripts/e2e-stack.sh
```

PowerSync then creates a **new** slot and replicates the whole database from the beginning. Watch
for `Replicating "..."` and `Flushed N updates` in `docker compose logs powersync`. Expect about a
minute on dev-sized data, longer on a large one; clients look stalled during it, which is normal.

Losing the bucket storage costs nothing — it is derived data, rebuilt from Postgres every time.

## The drill (run it, do not just read it)

1. `make backup`
2. `make restore FILE=<the dump> TARGET=tendto_restore_check REPLACE=--replace`
3. Compare the two databases:

```bash
for db in tendto tendto_restore_check; do
  docker compose exec -T db psql -tAq "postgresql://tendto:tendto@db:5432/$db" -c "
    SELECT 'blocks='||(SELECT count(*) FROM blocks)
       ||' pages='||(SELECT count(*) FROM pages)
       ||' items='||(SELECT count(*) FROM items)
       ||' auth_user='||(SELECT count(*) FROM \"user\");"
done
```

4. Point the stack at the restored copy and run the app against it: change the database name in
   `.env` (`DATABASE_URL`, `AUTH_DATABASE_URL`) and in `infra/powersync/config.yaml`, **wipe the
   bucket storage as above**, then re-run `scripts/e2e-stack.sh`. **Put both files back
   afterwards.**
5. Run a sync-dependent spec — `sync-loop.spec.ts` is the honest one, because it is the only
   check that fails when replication is silently dead.

## Drill record

**2026-09-04, dev stack** (Postgres 16 in docker, ~2 MB of data: 1,062 blocks, 981 pages,
1,254 items, 3,435 workspaces, 3,983 auth users).

| Step | Result | Time |
| --- | --- | --- |
| `make backup` | 2.1 MB archive, 19 tables with data | < 1s |
| Archive verification (`pg_restore -l`) | 105 TOC entries, readable | instant |
| `make restore` into a scratch database | 19 tables in `public` | ~2s |
| Row counts, live vs restored | **identical on every table checked** | — |
| better-auth tables (`user`, `session`) | present, identical counts | — |
| `powersync` publication | survived the dump and restore | — |
| Stack booted against the restored database | API, auth and PowerSync all healthy | ~30s |
| First app run against the restored database | **10 of 14 specs failed** — replication was dead | 10.3 min |
| Same run after wiping the bucket storage | **14 of 14 passed** | 1.8 min |
| Stack returned to the live database | healthy; 6-spec sync smoke test passed | ~2 min |

The headline result: **the Postgres restore was perfect and the app was still broken.** Every row
matched, and no workspace content reached any client, because PowerSync was resuming from a slot
that did not exist. The ten-minute run time is itself the symptom — every sync assertion sat
waiting for its timeout.

The failure is **symmetric**. Pointing the stack back at the live database reproduced it exactly,
because the bucket storage then remembered the scratch database's slot. Any time PowerSync is
aimed at a different database — including back at the original — wipe its storage.

Clean up afterwards, in this order:

```bash
# a slot pins its database, so it must go before the database does
docker compose exec -T db psql postgresql://tendto:tendto@db:5432/postgres \
  -c "SELECT pg_drop_replication_slot('<old slot name>');"
docker compose exec -T db psql postgresql://tendto:tendto@db:5432/postgres \
  -c 'DROP DATABASE IF EXISTS tendto_restore_check WITH (FORCE);'
```

An orphaned slot is not cosmetic: Postgres retains WAL for it forever, and it will fill the disk.

Three more faults were found by running the drill rather than writing it:

- The first verification piped the archive through `docker exec`. A custom-format archive needs
  random access and a pipe cannot seek, so a perfectly good 2 MB dump was reported corrupt. Both
  scripts now use a seekable file — the host reads the table of contents, and `restore.sh` copies
  the archive into the container instead of piping it.
- `pkill -f 'bun --env-file=...'` typed at a shell matches **that shell's own command line** and
  kills it. `scripts/dev-down.sh` is safe because a script's command line is just its path; ad-hoc
  use is not. Use a bracket in the pattern (`'[b]un --env-file=...'`) when typing one by hand.
- The drill must end with a sync-dependent spec. `auth.spec.ts` and `search.spec.ts` both passed
  against the completely un-replicating database, because they never need another device.

## Production (Supabase)

Supabase takes its own backups and offers point-in-time recovery — use those first; they are
continuous, and these scripts are not. `scripts/backup.sh` is for a portable copy you hold
yourself: an export before a risky migration, a local snapshot, or moving off the platform.

Two caveats for a managed database:

- The scripts run `pg_dump`/`pg_restore` **inside the `db` container**, whose client is
  PostgreSQL 16. Dumping a newer server with an older client fails outright. Point them at a
  matching client, or use `pg_dump` on the host if its version is at least the server's.
- Nothing here backs up anything outside Postgres. Today that is only PowerSync's MongoDB cache,
  which is rebuilt from Postgres — but only after you wipe it, per the section above. Object
  storage would need its own plan; there is none yet, as images are still inline data URLs.
- PowerSync Cloud has no `mongodata` volume to delete. Reset replication from its dashboard
  ("Deploy / redeploy" the instance) so it takes a fresh slot and re-replicates.
