---
name: rls-backstop
description: RLS is installed but deliberately NOT forced — the owner (API, Alembic, PowerSync) bypasses it; the ordered three steps to make it actually bind, and why the order matters
metadata:
  type: project
---

Migration `0008_rls`. Policies and the full reasoning live in `apps/api/app/models/rls.py`;
this is the decision, so nobody "fixes" it by adding FORCE.

## What was decided

RLS is **enabled** on every tenant-scoped table with correct policies, and deliberately **not
forced**. A table's owner bypasses RLS unless `FORCE ROW LEVEL SECURITY` is set, and the API,
Alembic and PowerSync all connect as the owner (`tendto`). So the policies do not constrain the
app today.

**Do not simply add FORCE.** PowerSync's *initial snapshot* is ordinary `SELECT`s as the
connecting role. Force RLS without giving PowerSync a `BYPASSRLS` role first and it replicates
zero rows — sync silently dead while the app still signs in and searches normally. That is the
exact failure mode in [[backup-restore]], and it is very hard to recognise.

What the policies buy today is still real: any *other* role — psql, a Supabase dashboard role,
an analytics login, a leaked non-owner credential — sees only what `app.current_user_id`
entitles it to, and nothing at all when that setting is unset (deny by default).

## To make it bind the API — in this order

1. Give PowerSync its own replication role with `BYPASSRLS`; point `infra/powersync/config.yaml`
   at it.
2. Move the API onto the `tendto_app` role and `SET LOCAL app.current_user_id` per transaction.
3. `ALTER TABLE ... FORCE ROW LEVEL SECURITY`.

Reversing 1 and 3 breaks sync. Do this before strangers can reach the API.

## Two things that will bite

- **Policy recursion.** Every workspace policy asks "which workspaces is this user in?", which
  reads `memberships` — itself RLS-protected by a policy asking the same question. As a plain
  subquery Postgres raises `infinite recursion detected in policy`. The fix is the
  `app_user_workspaces()` `SECURITY DEFINER` function, which runs as the owner and so bypasses
  RLS. Its `search_path` is pinned; a SECURITY DEFINER function without that is an escalation
  hole.
- **An INSERT policy takes `WITH CHECK` only** — Postgres rejects `USING` on it, since there is
  no pre-existing row to test.

## Why the policies live in Python, not in the migration

The test database is built with `create_all`, not migrations, so policies written only in
Alembic would be absent from every test. `rls_statements()` is the single source both use, and
`app/tests/test_rls.py` reaches the non-owner role with `SET LOCAL ROLE` — otherwise the
policies would ship completely unexercised.

## Related: the multi-worker guard

`app/startup_checks.py` now refuses to boot with `--workers N>1` unless
`TENDTO_ALLOW_MULTIPLE_WORKERS=1`. The AI spend guards (`app/ai/limits.py`) keep state in the
process, so N workers means N times the rate limit — and it fails **open**, i.e. real money and,
on the CLI engine, forked subprocesses. Presence's registry shards the same way but fails closed.
