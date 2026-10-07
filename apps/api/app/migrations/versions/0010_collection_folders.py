"""collections.parent_id + collections.kind — folders in the Collections section

The Collections section gets the same folders as Pages (0009): a folder is a collections row
with kind = 'folder' and no items, and `parent_id` nests a collection or a folder in one. Both
columns ride the existing `SELECT * FROM collections` sync rule and the upload allowlist.

`parent_id` is not a foreign key, matching pages.parent_id: the client walks a folder's
contents and deletes them itself, and a dangling parent after a concurrent delete is shown at
the top level rather than rejected. `kind` is nullable with no CHECK for the reason in 0009: a
constraint violation on upload would 500 and wedge the device's ordered queue. The server
default backfills existing rows as 'collection'.

Three-place rule (.claude/skills/db-migration): apps/api/app/models/core.py and
apps/web/src/lib/powersync/schema.ts change with this migration.

Revision ID: 0010_collection_folders
Revises: 0009_page_kind
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010_collection_folders"
down_revision: str | None = "0009_page_kind"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "collections",
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "collections",
        sa.Column("kind", sa.Text(), nullable=True, server_default=sa.text("'collection'")),
    )


def downgrade() -> None:
    op.drop_column("collections", "kind")
    op.drop_column("collections", "parent_id")
