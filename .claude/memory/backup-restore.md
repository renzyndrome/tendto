---
name: backup-restore
description: Restoring Postgres is only half a restore — PowerSync's Mongo bucket storage must be wiped too, or replication is silently dead while the app still looks fine
metadata:
  type: project
---

Full runbook and the drill record live in [`docs/backup-restore.md`](../../docs/backup-restore.md).
This is the part that will cost you an afternoon if you forget it.

## Restoring Postgres does not restore the system

PowerSync keeps, in its **MongoDB** bucket storage, both "initial replication is done" and the
name of the Postgres **replication slot** it owns. A restored database has no such slot. Point
PowerSync at one and it concludes it is already up to date, then fails forever:

    [powersync_3_1692] Initial replication already done
    [powersync_3_1692] Replication error replication slot "powersync_3_1692" was not created in this database

**Nothing replicates, and the app still looks alive.** Sign-in works, local search works, a
client's own `user_private` bucket syncs. Only workspace content never arrives. In the drill this
passed `auth.spec.ts` and `search.spec.ts` while failing all ten cross-device specs — so **always
finish a restore with a sync-dependent check** (`sync-loop.spec.ts`); the local-only ones will lie
to you.

The fix is to delete the `mongodata` volume and let PowerSync take a fresh slot and re-replicate.
Restarting the container is NOT enough. The bucket storage is derived data — losing it costs
nothing.

**This is symmetric.** Pointing the stack *back* at the original database reproduced the same
failure, because the storage then remembered the scratch database's slot. Any repoint means a
wipe, in both directions.

Clean up in order: drop the old replication slot BEFORE dropping the database it pins (a slot
blocks `DROP DATABASE`), and do drop it — Postgres retains WAL for an orphaned slot forever.

## Two smaller traps

- **One database holds app AND auth tables** (`AUTH_DATABASE_URL` points at the same database),
  so a backup is always the whole database. Restoring only the app half leaves every `user_id`
  and membership pointing at people who no longer exist.
- A `pg_dump -Fc` archive **cannot be piped** — the custom format needs random access. Piping one
  through `docker exec` made a perfectly good backup look corrupt. See also [[replica-timestamps]]
  for the other "it worked locally and broke after the round-trip" trap.
