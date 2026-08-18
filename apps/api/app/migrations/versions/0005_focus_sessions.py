"""focus_sessions — completed Pomodoro work sessions, the first USER-owned synced table

Not workspace-scoped, on purpose: the `workspace_content` bucket fans every row of a workspace
out to every member, so a Pomodoro history carrying a workspace_id would land on teammates'
devices — and once data has synced to a device it stays there (docs/planning/05 §isolation).
This table rides a NEW user-scoped bucket, `user_private`, keyed on request.user_id().

`local_date` is a TEXT wall-clock label rather than a DATE for two reasons: the server never
learns the device's timezone (so it cannot derive the user's day from `started_at`), and the
upload path binds client values raw — asyncpg rejects a date-shaped string for a date column.

Three-place rule (.claude/skills/db-migration) — these change together with this migration:
apps/api/app/models/core.py, infra/powersync/sync-rules.yaml,
apps/web/src/lib/powersync/schema.ts. Plus apps/api/app/routers/sync.py, where TABLE_MODELS is
the upload allowlist, USER_OWNED_TABLES is the new authorization branch, and DATETIME_COLUMNS
parses `started_at` (the first client-supplied timestamp column in the app).

Revision ID: 0005_focus_sessions
Revises: 0004_block_item_owner
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_focus_sessions"
down_revision: str | None = "0004_block_item_owner"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "focus_sessions",
        sa.Column("id", sa.UUID(), nullable=False),
        # better-auth user id; no FK — better-auth owns `user` (see memberships.user_id).
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        # `YYYY-MM-DD` in the USER's timezone: a wall-clock label, not an instant.
        sa.Column("local_date", sa.String(length=10), nullable=False),
        sa.Column("minutes", sa.Integer(), nullable=False),
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
    op.create_index(
        "ix_focus_sessions_user_date", "focus_sessions", ["user_id", "local_date"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_focus_sessions_user_date", table_name="focus_sessions")
    op.drop_table("focus_sessions")
