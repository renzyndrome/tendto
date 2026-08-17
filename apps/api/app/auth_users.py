"""Read-only access to better-auth's `user` table.

better-auth owns these tables (its own CLI migrates them), so they are deliberately NOT
SQLAlchemy models: mapping them into `Base.metadata` would let Alembic autogenerate and the
test fixtures create/drop tables that another service owns. Raw SELECTs keep the ownership
boundary honest, and this module is the only place that reaches across it.

Identity still comes from the verified JWT (app/auth.py) — this is only for *displaying*
teammates and resolving an invite email to an existing account.
"""

from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def emails_for(session: AsyncSession, user_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Map better-auth user id -> {"email": ..., "name": ...} for the ids given."""
    if not user_ids:
        return {}
    rows = await session.execute(
        text('SELECT id, email, name FROM "user" WHERE id = ANY(:ids)'),
        {"ids": user_ids},
    )
    return {row.id: {"email": row.email, "name": row.name} for row in rows}


async def find_user_id_by_email(session: AsyncSession, email: str) -> str | None:
    """Resolve an email to a better-auth user id, case-insensitively. None if no such account."""
    return await session.scalar(
        text('SELECT id FROM "user" WHERE lower(email) = lower(:email) LIMIT 1'),
        {"email": email},
    )


async def email_for_user(session: AsyncSession, user_id: str) -> str | None:
    return await session.scalar(text('SELECT email FROM "user" WHERE id = :id'), {"id": user_id})


async def workspace_name(session: AsyncSession, workspace_id: UUID) -> str | None:
    return await session.scalar(
        text("SELECT name FROM workspaces WHERE id = :id"), {"id": workspace_id}
    )
