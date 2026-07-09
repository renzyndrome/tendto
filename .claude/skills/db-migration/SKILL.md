---
name: db-migration
description: Create and apply Alembic migrations for TendTo, including the three-place rule for synced tables. Use for any schema change under apps/api/app/models.
---

# Database migrations

## First-time setup (Alembic not yet initialized)

```bash
cd apps/api
alembic init alembic
```
Then in `alembic/env.py`: import `from app.models import Base`, set
`target_metadata = Base.metadata`, and read the DB URL from `app.config.get_settings()`
(convert `+asyncpg` to a sync driver for Alembic, or use `run_async` migrations).

## Every schema change — the three-place rule

A change to a **synced** table is not done until all three are updated together:

1. `apps/api/app/models/core.py` — SQLAlchemy model
2. `infra/powersync/sync-rules.yaml` — if a new table or column filtering changed
3. `apps/web/src/lib/powersync/schema.ts` — client schema mirror

Skipping (3) fails silently: the column syncs but the client can't see it.

## Workflow

```bash
cd apps/api
alembic revision --autogenerate -m "add <thing>"
# REVIEW the generated migration — autogenerate misses JSONB defaults and indexes sometimes
alembic upgrade head
```

## Rules

- Synced tables MUST have: UUID PK (client-generated), `workspace_id`, `created_at`,
  `updated_at` (server_default=now(), onupdate). Use `TimestampMixin`.
- Never rename synced columns in place — add new, backfill, drop later (clients with old
  replicas will still upload old shapes).
- After changing sync rules: the PowerSync service revalidates buckets; expect clients to
  re-sync affected buckets. Restart the service in dev: `docker compose restart powersync`.
