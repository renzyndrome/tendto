"""user_ai_settings — a user's own AI provider, model and encrypted API key

SERVER-ONLY: not in sync-rules.yaml, the client schema or TABLE_MODELS. It holds a credential,
and anything synced stays on every device for good. Read and written over /ai/settings only.

The RLS backstop is installed here, not by 0008, for the reason 0012 gives. See
`LATER_USER_TABLES` in rls.py.

Revision ID: 0015_user_ai_settings
Revises: 0014_builtin_templates
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.models.rls import user_table_rls, user_table_rls_drop

revision: str = "0015_user_ai_settings"
down_revision: str | None = "0014_builtin_templates"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_ai_settings",
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("base_url", sa.Text(), server_default="", nullable=False),
        sa.Column("model", sa.Text(), nullable=False),
        sa.Column("api_key_encrypted", sa.Text(), nullable=False),
        sa.Column("key_hint", sa.String(length=16), server_default="", nullable=False),
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
        sa.PrimaryKeyConstraint("user_id"),
    )
    for statement in user_table_rls("user_ai_settings", "user_id"):
        op.execute(statement)


def downgrade() -> None:
    for statement in user_table_rls_drop("user_ai_settings"):
        op.execute(statement)
    op.drop_table("user_ai_settings")
