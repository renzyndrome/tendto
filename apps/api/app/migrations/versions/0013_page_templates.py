"""page_templates — a user's own page templates

USER-owned, like favorites (0012): it rides the `user_private` sync bucket and sync.py
authorizes it by owner, never by membership. A template follows its owner into every workspace
and never reaches a teammate's device.

The RLS backstop is installed here, not by 0008, for the reason 0012 gives. See
`LATER_USER_TABLES` in rls.py.

Also changed with this migration: TABLE_MODELS and USER_OWNED_TABLES in
apps/api/app/routers/sync.py, the `user_private` bucket in infra/powersync/sync-rules.yaml, and
apps/web/src/lib/powersync/schema.ts.

Revision ID: 0013_page_templates
Revises: 0012_favorites
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.models.rls import user_table_rls, user_table_rls_drop

revision: str = "0013_page_templates"
down_revision: str | None = "0012_favorites"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "page_templates",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.Text(), server_default="", nullable=False),
        sa.Column("content", sa.Text(), server_default="[]", nullable=False),
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
    op.create_index("ix_page_templates_user", "page_templates", ["user_id"], unique=False)
    for statement in user_table_rls("page_templates", "user_id"):
        op.execute(statement)


def downgrade() -> None:
    for statement in user_table_rls_drop("page_templates"):
        op.execute(statement)
    op.drop_index("ix_page_templates_user", table_name="page_templates")
    op.drop_table("page_templates")
