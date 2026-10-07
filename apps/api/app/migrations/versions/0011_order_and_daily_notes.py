"""collections.position + pages.journal_date — manual order and daily notes

`collections.position` lets the Collections tree keep the order a row was dragged to, as pages
already do. Nullable with a default of 0: a device on an older build never sends it, and
existing rows keep their creation order (the tree sorts by position, then created_at).

`pages.journal_date` marks a page as the daily note for one LOCAL calendar day (YYYY-MM-DD), a
wall-clock label like focus_sessions.local_date, because the server never learns the device's
timezone. NULL for every other page.

Three-place rule (.claude/skills/db-migration): apps/api/app/models/core.py and
apps/web/src/lib/powersync/schema.ts change with this migration. `SELECT *` sync rules already
carry both columns.

Revision ID: 0011_order_and_daily_notes
Revises: 0010_collection_folders
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011_order_and_daily_notes"
down_revision: str | None = "0010_collection_folders"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "collections",
        sa.Column("position", sa.Integer(), nullable=True, server_default=sa.text("0")),
    )
    op.add_column("pages", sa.Column("journal_date", sa.String(length=10), nullable=True))


def downgrade() -> None:
    op.drop_column("pages", "journal_date")
    op.drop_column("collections", "position")
