"""row-level security — the database-level tenancy backstop

Doc 05 §4 has always called RLS the backstop under FastAPI's membership checks; this installs
it. The policies themselves, and the reasoning behind them, live in `app/models/rls.py` — the
migration and the test schema (built with `create_all`, not migrations) both execute that one
set of statements so they cannot drift.

**These policies are deliberately NOT forced on the table owner.** The API, Alembic and
PowerSync all connect as `tendto`, which owns the tables, and a table's owner bypasses RLS
unless `FORCE ROW LEVEL SECURITY` is set. Forcing it here would break the app in the worst
available way: PowerSync's initial snapshot is ordinary SELECTs, so it would replicate zero rows
and leave sync silently dead while the app still signed in and searched normally — precisely the
failure recorded in `docs/backup-restore.md`.

What this migration buys today is that any OTHER role — psql, a Supabase dashboard role, an
analytics login, a leaked non-owner credential — is confined to what `app.current_user_id`
entitles it to, and sees nothing when that setting is unset. The `tendto_app` role it creates
exists so the boundary is tested rather than assumed (see `app/tests/test_rls.py`).

Making it bind the API is a three-step change, in this order: give PowerSync a `BYPASSRLS`
replication role, move the API onto `tendto_app` with `SET LOCAL app.current_user_id` per
transaction, then add FORCE. Reversing the first and last breaks sync.

Revision ID: 0008_rls
Revises: 0007_presence
"""

from collections.abc import Sequence

from alembic import op

from app.models.rls import rls_drop_statements, rls_statements

revision: str = "0008_rls"
down_revision: str | None = "0007_presence"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for statement in rls_statements():
        op.execute(statement)


def downgrade() -> None:
    for statement in rls_drop_statements():
        op.execute(statement)
