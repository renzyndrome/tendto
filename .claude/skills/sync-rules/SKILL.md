---
name: sync-rules
description: Edit PowerSync sync rules safely — the download tenancy boundary. Use when adding a synced table, changing what data reaches devices, or debugging "data not appearing on client".
---

# Sync rules (infra/powersync/sync-rules.yaml)

Sync rules decide **what flows down to each device**. They are the download half of the
tenancy boundary (upload half = FastAPI permission checks). Treat edits as security-sensitive.

## Model

- `workspace_content` bucket: parameterized by the user's memberships — one bucket instance
  per workspace the user belongs to. All tenant content tables live here.
- `user_meta` bucket: the user's own memberships + workspaces (sidebar data).

## Adding a synced table

1. Add the table to the `workspace_content` bucket's `data:` list:
   `- SELECT * FROM <table> WHERE workspace_id = bucket.workspace_id`
2. Confirm the table has `workspace_id` (invariant) — if it doesn't, fix the model first.
3. Mirror it in `apps/web/src/lib/powersync/schema.ts` and the SQLAlchemy model
   (three-place rule — see `db-migration` skill).
4. `docker compose restart powersync`, then watch logs for rule validation errors.

## Security review checklist (every edit)

- Every `data:` query filters by `bucket.workspace_id` (or `bucket.user_id` in user_meta).
  An unfiltered SELECT leaks the whole table to every user.
- Parameter queries only use `request.user_id()` (the verified JWT sub) — never client-supplied
  parameters for tenancy.
- Remember the one-way door: data already synced to a device stays there even after access
  revocation. Never put "must be revocable" secrets in synced tables.

## Debugging "row not on client"

1. Is the table in sync-rules? 2. Does the row have the right `workspace_id`?
3. Does the user have a membership row? 4. Client schema has the table/column?
5. PowerSync logs (`docker compose logs powersync`) — replication errors show here.
