"""Test-suite building blocks: the test engine, ids, and seed/query helpers.

Kept out of conftest so tests can import them without importing the fixtures module.
"""

import os
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.models.core import Membership, Page, Workspace

# The tests TRUNCATE every table before each run, so they MUST target a throwaway database, never
# the dev/prod DB. Read a dedicated TEST_DATABASE_URL (NOT the app's DATABASE_URL, which points at
# real data) and default to a separate `tendto_test` database. See the guard in conftest.py.
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://tendto:tendto@localhost:15432/tendto_test"
)
TEST_USER_ID = "user_test_1"


def database_name(url: str) -> str:
    """The database name from a SQLAlchemy URL (the part after the last '/', minus any query)."""
    return url.rsplit("/", 1)[-1].split("?", 1)[0]


# NullPool: the app request (run via httpx's ASGI transport) and the test share one event
# loop, but a pooled asyncpg connection must never straddle loops — NullPool sidesteps it.
engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
TestSession = async_sessionmaker(engine, expire_on_commit=False)


async def seed_membership(
    *,
    user_id: str,
    role: str = "owner",
    workspace_id: UUID | None = None,
    name: str = "Test Workspace",
) -> UUID:
    """Provision a workspace + one membership directly (bypassing the API)."""
    workspace_id = workspace_id or uuid4()
    async with TestSession() as session:
        session.add(Workspace(id=workspace_id, name=name))
        await session.flush()  # workspace must land before the membership FK references it
        session.add(Membership(id=uuid4(), user_id=user_id, workspace_id=workspace_id, role=role))
        await session.commit()
    return workspace_id


async def seed_page(*, workspace_id: UUID, page_id: UUID | None = None, title: str = "P") -> UUID:
    page_id = page_id or uuid4()
    async with TestSession() as session:
        session.add(Page(id=page_id, workspace_id=workspace_id, title=title, position=0))
        await session.commit()
    return page_id


async def fetch(model: Any, pk: Any) -> Any:
    """Read a row back through a fresh session (READ COMMITTED sees the API's commit)."""
    async with TestSession() as session:
        return await session.get(model, pk)


async def count(model: Any) -> int:
    async with TestSession() as session:
        return await session.scalar(select(func.count()).select_from(model)) or 0
