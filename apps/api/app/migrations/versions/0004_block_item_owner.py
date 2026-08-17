"""blocks can belong to an item's description as well as to a page

Item descriptions reuse `blocks` instead of getting their own table, so a card body is the
same primitive as a page body. `page_id` therefore becomes nullable and a sibling `item_id`
is added, with a CHECK that exactly one is set — both columns arrive from a client, so the
invariant is enforced in the database rather than only in application code.

Three-place rule (.claude/skills/db-migration): the model and
apps/web/src/lib/powersync/schema.ts change with this. sync-rules.yaml does NOT: it already
selects `*` from blocks scoped by workspace_id, and item bodies ride the same bucket.

Revision ID: 0004_block_item_owner
Revises: 0003_workspace_invitations
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_block_item_owner"
down_revision: str | None = "0003_workspace_invitations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("blocks", sa.Column("item_id", sa.UUID(), nullable=True))
    op.alter_column("blocks", "page_id", existing_type=sa.UUID(), nullable=True)
    op.create_foreign_key(
        "blocks_item_id_fkey", "blocks", "items", ["item_id"], ["id"], ondelete="CASCADE"
    )
    op.create_index("ix_blocks_item", "blocks", ["item_id"], unique=False)
    op.create_check_constraint(
        "ck_blocks_exactly_one_owner",
        "blocks",
        "(page_id IS NOT NULL) <> (item_id IS NOT NULL)",
    )


def downgrade() -> None:
    # Item-owned blocks have no home in the old shape; drop them so page_id can be NOT NULL.
    op.execute("DELETE FROM blocks WHERE item_id IS NOT NULL")
    op.drop_constraint("ck_blocks_exactly_one_owner", "blocks", type_="check")
    op.drop_index("ix_blocks_item", table_name="blocks")
    op.drop_constraint("blocks_item_id_fkey", "blocks", type_="foreignkey")
    op.alter_column("blocks", "page_id", existing_type=sa.UUID(), nullable=False)
    op.drop_column("blocks", "item_id")
