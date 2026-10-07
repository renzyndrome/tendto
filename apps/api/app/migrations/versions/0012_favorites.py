"""favorites — a user's starred pages and collections

USER-owned, like focus_sessions (0005): it rides the `user_private` sync bucket and sync.py
authorizes it by owner, never by membership. Which pages someone starred must not reach their
teammates' devices.

The RLS backstop is installed here, not by 0008: that migration builds its statements from
app/models/rls.py at upgrade time, and listing this table there would make a fresh database fail
at 0008, before the table exists. See `LATER_USER_TABLES` in rls.py.

Also changed with this migration: TABLE_MODELS and USER_OWNED_TABLES in
apps/api/app/routers/sync.py, the `user_private` bucket in infra/powersync/sync-rules.yaml, and
apps/web/src/lib/powersync/schema.ts.

Revision ID: 0012_favorites
Revises: 0011_order_and_daily_notes
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.models.rls import user_table_rls, user_table_rls_drop

revision: str = "0012_favorites"
down_revision: str | None = "0011_order_and_daily_notes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "favorites",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("target_kind", sa.String(length=16), nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_favorites_user", "favorites", ["user_id"], unique=False)
    for statement in user_table_rls("favorites", "user_id"):
        op.execute(statement)


def downgrade() -> None:
    for statement in user_table_rls_drop("favorites"):
        op.execute(statement)
    op.drop_index("ix_favorites_user", table_name="favorites")
    op.drop_table("favorites")
