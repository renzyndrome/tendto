"""page_templates.builtin_id and .hidden — built-in templates a user edited or deleted

Built-in templates live in client code. A row with `builtin_id` set stands in for one: the
user's edited copy, or, with `hidden` = 1, a record that they deleted it, so it stays deleted on
every device. Both columns are nullable with no CHECK: a PUT carries every column, and a null or
unknown value from some client must not fail the batch and wedge its upload queue.

No sync-rule change: the `user_private` bucket selects `*` from page_templates. Mirrored in
apps/web/src/lib/powersync/schema.ts.

Revision ID: 0014_builtin_templates
Revises: 0013_page_templates
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014_builtin_templates"
down_revision: str | None = "0013_page_templates"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("page_templates", sa.Column("builtin_id", sa.Text(), nullable=True))
    op.add_column(
        "page_templates",
        sa.Column("hidden", sa.Integer(), server_default="0", nullable=True),
    )


def downgrade() -> None:
    op.drop_column("page_templates", "hidden")
    op.drop_column("page_templates", "builtin_id")
