"""Row-level security: the database-level backstop for tenancy (doc 05 §4).

FastAPI is the enforcement point — every write goes through `POST /sync/upload`, which checks
membership and role, and every read a device gets is chosen by the sync rules. This module is
the layer *underneath* that: if a query ever reaches Postgres without going through either, the
database itself should still refuse to hand over another tenant's rows.

## Who these policies actually bind

RLS does not apply to a table's OWNER unless `FORCE ROW LEVEL SECURITY` is set, and the API,
the migrations and PowerSync all connect as the owner (`tendto`). These policies are therefore
deliberately **not** forced, and they do not constrain the API today.

That is a considered choice, not an omission:

- PowerSync's *initial snapshot* is ordinary `SELECT`s as the connecting role. Forcing RLS
  without first giving PowerSync a `BYPASSRLS` role would return zero rows and leave replication
  silently dead — the exact failure mode documented in `docs/backup-restore.md`, where the app
  still signs in and searches normally while no content reaches any device.
- The API holds one pooled connection shared by every request, so binding it would first require
  setting `app.current_user_id` per transaction. That is a change to every request path, and it
  belongs with the work that makes the API a non-owner role.

So what these policies buy today is real but bounded: any *other* role — a psql session, a
Supabase dashboard role, an analytics or read-replica login, a leaked non-owner credential —
sees only what `app.current_user_id` entitles it to, and sees nothing at all when that setting
is unset. `APP_ROLE` below exists so that boundary is exercised rather than assumed: the tests
`SET ROLE` to it and prove cross-tenant reads come back empty.

## Making them bind the API (the remaining step, before strangers arrive)

1. Give PowerSync its own replication role with `BYPASSRLS` and point
   `infra/powersync/config.yaml` at it.
2. Have the API connect as `APP_ROLE` and `SET LOCAL app.current_user_id` per transaction.
3. Add `ALTER TABLE ... FORCE ROW LEVEL SECURITY`.

Do them in that order. Reversing 1 and 3 breaks sync.

## Why a SECURITY DEFINER function

Every workspace policy needs "which workspaces is this user in?", which reads `memberships` —
itself an RLS-protected table whose own policy asks the same question. Written as a plain
subquery that recurses and Postgres raises `infinite recursion detected in policy`. A
`SECURITY DEFINER` function runs as the owner, who bypasses RLS, which breaks the cycle. It is
`STABLE` so the planner evaluates it once per statement rather than once per row.
"""

#: A non-owner role that RLS binds. Granted DML but no ownership, so policies apply to it.
#: NOLOGIN: nothing connects as this role yet — the tests reach it with `SET ROLE`.
APP_ROLE = "tendto_app"

#: The session setting policies read. `current_setting(..., true)` returns NULL when it is
#: unset, and every policy below then matches no rows — an unconfigured session sees nothing.
USER_SETTING = "app.current_user_id"

#: Workspace-scoped tables and the column that pins each to its workspace. `workspaces` pins on
#: its own primary key. Membership in the workspace is the whole test — the same boundary the
#: `workspace_content` bucket draws in sync-rules.yaml.
_WORKSPACE_TABLES: dict[str, str] = {
    "workspaces": "id",
    "memberships": "workspace_id",
    "workspace_invitations": "workspace_id",
    "pages": "workspace_id",
    "blocks": "workspace_id",
    "collections": "workspace_id",
    "items": "workspace_id",
    "presence": "workspace_id",
}

#: Read by the workspace, written only by the author — the same split `AUTHOR_OWNED_TABLES` in
#: routers/sync.py enforces on the upload path. The bucket decides who reads; the author column
#: decides who writes.
_AUTHOR_OWNED = {"comments": ("workspace_id", "author_id")}

#: Personal data, keyed by user rather than workspace: the `user_private` bucket's tables.
#: A `workspace_id` here would fan someone's Pomodoro history out to their teammates.
_USER_TABLES = {"focus_sessions": "user_id"}

ALL_RLS_TABLES: tuple[str, ...] = (
    *_WORKSPACE_TABLES,
    *_AUTHOR_OWNED,
    *_USER_TABLES,
)

_CURRENT_USER = f"current_setting('{USER_SETTING}', true)"
_MEMBER_WORKSPACES = "app_user_workspaces()"


def _policy(
    table: str, name: str, command: str, *, using: str | None = None, check: str | None = None
) -> str:
    """One CREATE POLICY. INSERT takes WITH CHECK only — Postgres rejects USING on it, because
    there is no pre-existing row for it to test."""
    clauses = []
    if using is not None:
        clauses.append(f"USING ({using})")
    if check is not None:
        clauses.append(f"WITH CHECK ({check})")
    return f'CREATE POLICY "{name}" ON "{table}" FOR {command} TO "{APP_ROLE}" {" ".join(clauses)}'


def rls_statements() -> list[str]:
    """Every statement needed to install the backstop, in order. Idempotent where it can be.

    Shared by the Alembic migration and the test schema (which is built with `create_all`, not
    migrations) so the two cannot drift — the tests exercise the SQL that actually ships.
    """
    statements: list[str] = [
        # Roles are cluster-wide, so this runs against a role another database may already have.
        f"""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
                CREATE ROLE "{APP_ROLE}" NOLOGIN;
            END IF;
        END
        $$
        """,
        # SECURITY DEFINER: runs as the owner, who bypasses RLS, so the membership lookup inside
        # a memberships policy does not recurse. search_path is pinned because a SECURITY
        # DEFINER function with a caller-controlled search_path is a privilege-escalation hole.
        f"""
        CREATE OR REPLACE FUNCTION app_user_workspaces()
        RETURNS SETOF uuid
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
            SELECT workspace_id FROM memberships
            WHERE user_id = {_CURRENT_USER}
        $$
        """,
        "REVOKE ALL ON FUNCTION app_user_workspaces() FROM PUBLIC",
        f'GRANT EXECUTE ON FUNCTION app_user_workspaces() TO "{APP_ROLE}"',
    ]

    for table in ALL_RLS_TABLES:
        statements.append(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
        statements.append(f'GRANT SELECT, INSERT, UPDATE, DELETE ON "{table}" TO "{APP_ROLE}"')

    for table, column in _WORKSPACE_TABLES.items():
        member = f'"{column}" IN (SELECT {_MEMBER_WORKSPACES})'
        statements.append(_policy(table, f"{table}_member", "ALL", using=member, check=member))

    for table, (workspace_column, author_column) in _AUTHOR_OWNED.items():
        member = f'"{workspace_column}" IN (SELECT {_MEMBER_WORKSPACES})'
        mine = f'{member} AND "{author_column}" = {_CURRENT_USER}'
        # Read as a member, write only your own — two policies rather than one, because SELECT
        # and the write commands genuinely differ here.
        statements.append(_policy(table, f"{table}_read", "SELECT", using=member))
        statements.append(_policy(table, f"{table}_write_own", "INSERT", check=mine))
        statements.append(_policy(table, f"{table}_update_own", "UPDATE", using=mine, check=mine))
        statements.append(_policy(table, f"{table}_delete_own", "DELETE", using=mine))

    for table, column in _USER_TABLES.items():
        own = f'"{column}" = {_CURRENT_USER}'
        statements.append(_policy(table, f"{table}_own", "ALL", using=own, check=own))

    return statements


def rls_drop_statements() -> list[str]:
    """Undo `rls_statements`. The role itself is left alone: it is cluster-wide, so another
    database on the same server may still be using it."""
    statements: list[str] = []
    for table in ALL_RLS_TABLES:
        statements.append(f'REVOKE ALL ON "{table}" FROM "{APP_ROLE}"')
        statements.append(f'ALTER TABLE "{table}" DISABLE ROW LEVEL SECURITY')
    for table in _WORKSPACE_TABLES:
        statements.append(f'DROP POLICY IF EXISTS "{table}_member" ON "{table}"')
    for table in _AUTHOR_OWNED:
        for suffix in ("read", "write_own", "update_own", "delete_own"):
            statements.append(f'DROP POLICY IF EXISTS "{table}_{suffix}" ON "{table}"')
    for table in _USER_TABLES:
        statements.append(f'DROP POLICY IF EXISTS "{table}_own" ON "{table}"')
    statements.append("DROP FUNCTION IF EXISTS app_user_workspaces()")
    return statements
