"""pages.kind — a folder is a pages row with kind = 'folder'

Folders group pages in the sidebar. They reuse the pages tree (`parent_id`), the delete
cascade, the sync bucket and the upload allowlist, so this is one column and no new table.
`SELECT * FROM pages` in the sync rules carries it down unchanged.

Nullable, with no CHECK constraint: a PowerSync PUT carries every column, nulls included, and
the upload queue is ordered, so a constraint violation would 500 and wedge that device's writes.
Readers treat anything but 'folder' as a page. The server default backfills existing rows as
'page' (a constant default on ADD COLUMN, so no table rewrite).

Three-place rule (.claude/skills/db-migration): apps/api/app/models/core.py and
apps/web/src/lib/powersync/schema.ts change with this migration. Sync rules and TABLE_MODELS
already cover `pages`.

Revision ID: 0009_page_kind
Revises: 0008_rls
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009_page_kind"
down_revision: str | None = "0008_rls"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "pages",
        sa.Column("kind", sa.Text(), nullable=True, server_default=sa.text("'page'")),
    )


def downgrade() -> None:
    op.drop_column("pages", "kind")
