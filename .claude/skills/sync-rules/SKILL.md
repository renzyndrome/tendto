---
name: sync-rules
description: Edit PowerSync sync rules safely — the download tenancy boundary. Use when adding a synced table, changing what data reaches devices, or debugging "data not appearing on client".
---

# Sync rules (infra/powersync/sync-rules.yaml)

Sync rules decide **what flows down to each device**. They are the download half of the
tenancy boundary (upload half = FastAPI permission checks). Treat edits as security-sensitive.

## Model — two buckets, and picking the wrong one leaks data

- `workspace_content`: parameterized by the user's memberships — one instance per workspace the
  user belongs to. It carries the workspace row, its memberships, and all tenant content.
  **Everything in it reaches EVERY member of that workspace.**
- `user_private`: one instance per user, keyed on `request.user_id()` directly (the parameter
  query reads no table). Holds rows that belong to a person rather than a workspace —
  `focus_sessions` today.

**Bucket ≠ permission.** A row in `workspace_content` reaches every member, but that says
nothing about who may *write* it. `comments` are the case in point: everyone reads the thread,
yet only the author may edit their own comment. That narrowing lives entirely in the upload path
(`AUTHOR_OWNED_TABLES` in sync.py), never in the rules — do not reach for a new bucket to express
a write rule.

## Adding a synced table

**Step 0 — which bucket?** This is a one-way door: once a row reaches a teammate's device it is
on that device, and moving the table later does not recall it.

- Shared workspace content (pages, items, …) → `workspace_content`, and the table needs a
  `workspace_id`.
- Anything PERSONAL — someone's history, preferences, private notes-to-self → `user_private`,
  and the table needs a `user_id` instead. Do **not** give it a `workspace_id` "for
  consistency"; that is what puts it in the wrong bucket.

Then:

1. Add it to the chosen bucket's `data:` list, filtered by that bucket's key:
   `- SELECT * FROM <table> WHERE workspace_id = bucket.workspace_id`, or
   `- SELECT * FROM <table> WHERE user_id = bucket.user_id`.
2. Mirror it in `apps/web/src/lib/powersync/schema.ts` and the SQLAlchemy model
   (see `db-migration` skill).
3. Add it to `TABLE_MODELS` in `apps/api/app/routers/sync.py` — that dict is the upload
   **allowlist**, so a table missing from it is rejected with a 400. A user-owned table also
   goes in `USER_OWNED_TABLES`, which authorizes by owner instead of by membership; a
   workspace table whose rows belong to one person (a comment) goes in `AUTHOR_OWNED_TABLES`,
   which keeps the membership check and adds a per-row author check on top.
4. A client-supplied timestamp column must be listed in `DATETIME_COLUMNS` (same file): the
   upload path binds client values raw and asyncpg refuses an ISO string for `timestamptz`.
   The resulting 500 wedges that device's upload queue permanently.
5. `docker compose restart powersync`, then watch logs for rule validation errors.

## Security review checklist (every edit)

- Every `data:` query filters by its own bucket's key — `bucket.workspace_id` in
  `workspace_content`, `bucket.user_id` in `user_private`. An unfiltered SELECT leaks the whole
  table to every user.
- No table appears in BOTH buckets. Personal data in `workspace_content` is a leak even if it
  is also correctly in `user_private`.
- Parameter queries only use `request.user_id()` (the verified JWT sub) — never client-supplied
  parameters for tenancy.
- Remember the one-way door: data already synced to a device stays there even after access
  revocation. Never put "must be revocable" secrets in synced tables.

## Debugging "row not on client"

1. Is the table in sync-rules? 2. Does the row have the right `workspace_id` / `user_id` for
its bucket? 3. Does the user have a membership row (workspace tables only)? 4. Client schema
has the table/column? 5. PowerSync logs (`docker compose logs powersync`) — replication errors
show here. 6. Is the table in the publication? `select tablename from pg_publication_tables
where pubname='powersync'` — a publication built for an explicit table list will not pick up a
new table, and the symptom is deceptive: uploads succeed, rows just never come back down.
