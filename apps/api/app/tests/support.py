"""Test-suite building blocks: the test engine, ids, and seed/query helpers.

Kept out of conftest so tests can import them without importing the fixtures module.
"""

import os
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit, urlunsplit
from uuid import UUID, uuid4

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.models.core import (
    Collection,
    Comment,
    FocusSession,
    Item,
    Membership,
    Page,
    Workspace,
)

# The suite TRUNCATES every table before each test (see conftest._prepare_db), so it must never
# point at a database anyone cares about. It used to default to DATABASE_URL — the dev database
# — which meant a routine `make test` silently destroyed local workspaces, pages and blocks.
#
# Default is now a dedicated database, created on demand, and `_assert_not_dev_database` refuses
# to run against the dev one unless you deliberately opt in. Override with TEST_DATABASE_URL.
DEFAULT_TEST_DB = "tendto_test"

# Set to "1" only when you genuinely want the suite to wipe the database in DATABASE_URL.
ALLOW_DEV_DB_ENV = "TENDTO_TEST_ALLOW_DEV_DB"


def _default_test_url() -> str:
    """The dev connection with its database name swapped for the test one."""
    parts = urlsplit(get_settings().database_url)
    return urlunsplit(parts._replace(path=f"/{DEFAULT_TEST_DB}"))


def _database_name(url: str) -> str:
    return urlsplit(url).path.lstrip("/")


TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL") or _default_test_url()


def assert_safe_test_database() -> None:
    """Fail loudly rather than truncate a database that holds real work."""
    dev_db = _database_name(get_settings().database_url)
    test_db = _database_name(TEST_DATABASE_URL)
    if test_db == dev_db and os.environ.get(ALLOW_DEV_DB_ENV) != "1":
        raise RuntimeError(
            f"Refusing to run tests against '{test_db}': it is the database in DATABASE_URL, "
            "and this suite truncates every table before each test. Unset TEST_DATABASE_URL to "
            f"use '{DEFAULT_TEST_DB}', or set {ALLOW_DEV_DB_ENV}=1 if you really mean it."
        )


TEST_USER_ID = "user_test_1"

assert_safe_test_database()  # fail at import, before anything can truncate

# NullPool: the app request (run via httpx's ASGI transport) and the test share one event
# loop, but a pooled asyncpg connection must never straddle loops — NullPool sidesteps it.
engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
TestSession = async_sessionmaker(engine, expire_on_commit=False)


async def ensure_test_database() -> None:
    """Create the test database if it doesn't exist, so `make test` needs no setup.

    CREATE DATABASE can't run inside a transaction, hence AUTOCOMMIT, and it is issued against
    the server's default `postgres` database rather than the target.
    """
    target = _database_name(TEST_DATABASE_URL)
    admin_url = urlunsplit(urlsplit(TEST_DATABASE_URL)._replace(path="/postgres"))
    admin = create_async_engine(admin_url, poolclass=NullPool, isolation_level="AUTOCOMMIT")
    try:
        async with admin.connect() as conn:
            exists = await conn.scalar(
                text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": target}
            )
            if not exists:
                # Identifier can't be parameterised; it comes from our own config, and the
                # quoting keeps a surprising name from being interpreted as SQL.
                await conn.execute(text(f'CREATE DATABASE "{target}"'))
    finally:
        await admin.dispose()


# better-auth owns the `user` table and migrates it with its own CLI, so it is absent from
# Base.metadata and from a freshly created test database. Member listing and invite acceptance
# read it (app/auth_users.py), so the suite creates the columns it actually touches.
AUTH_USER_DDL = """
CREATE TABLE IF NOT EXISTS "user" (
    id text PRIMARY KEY,
    name text NOT NULL DEFAULT '',
    email text NOT NULL,
    "emailVerified" boolean NOT NULL DEFAULT false,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
)
"""


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


async def add_membership(*, user_id: str, workspace_id: UUID, role: str = "editor") -> None:
    """Add another member to an EXISTING workspace.

    `seed_membership` always creates the workspace too, so reusing it to add a second member
    to the same workspace would violate workspaces_pkey.
    """
    async with TestSession() as session:
        session.add(Membership(id=uuid4(), user_id=user_id, workspace_id=workspace_id, role=role))
        await session.commit()


async def seed_page(*, workspace_id: UUID, page_id: UUID | None = None, title: str = "P") -> UUID:
    page_id = page_id or uuid4()
    async with TestSession() as session:
        session.add(Page(id=page_id, workspace_id=workspace_id, title=title, position=0))
        await session.commit()
    return page_id


async def seed_collection(
    *, workspace_id: UUID, collection_id: UUID | None = None, name: str = "C"
) -> UUID:
    collection_id = collection_id or uuid4()
    async with TestSession() as session:
        session.add(Collection(id=collection_id, workspace_id=workspace_id, name=name))
        await session.commit()
    return collection_id


async def seed_item(
    *,
    workspace_id: UUID,
    collection_id: UUID | None = None,
    item_id: UUID | None = None,
    title: str = "Card",
) -> UUID:
    """Insert an item, creating its collection when one isn't supplied (items.collection_id is
    a real FK, so a bare item would violate it)."""
    if collection_id is None:
        collection_id = await seed_collection(workspace_id=workspace_id)
    item_id = item_id or uuid4()
    async with TestSession() as session:
        session.add(
            Item(
                id=item_id,
                workspace_id=workspace_id,
                collection_id=collection_id,
                properties={"title": title},
                position=0,
            )
        )
        await session.commit()
    return item_id


async def seed_comment(
    *,
    workspace_id: UUID,
    author_id: str,
    page_id: UUID | None = None,
    item_id: UUID | None = None,
    comment_id: UUID | None = None,
    body: str = "hello",
    author_label: str = "test@example.com",
    authored_at: datetime | None = None,
) -> UUID:
    """Insert a comment directly. Exactly one of page_id/item_id — the DB enforces the XOR."""
    comment_id = comment_id or uuid4()
    async with TestSession() as session:
        session.add(
            Comment(
                id=comment_id,
                workspace_id=workspace_id,
                page_id=page_id,
                item_id=item_id,
                author_id=author_id,
                author_label=author_label,
                body=body,
                authored_at=authored_at or datetime(2026, 8, 20, 9, 0, tzinfo=UTC),
            )
        )
        await session.commit()
    return comment_id


async def seed_focus_session(
    *,
    user_id: str,
    session_id: UUID | None = None,
    local_date: str = "2026-08-18",
    minutes: int = 25,
    started_at: datetime | None = None,
) -> UUID:
    """Insert a focus session directly. Unlike everything else here it takes no workspace —
    `focus_sessions` is user-owned (see the model)."""
    session_id = session_id or uuid4()
    async with TestSession() as session:
        session.add(
            FocusSession(
                id=session_id,
                user_id=user_id,
                started_at=started_at or datetime(2026, 8, 18, 9, 0, tzinfo=UTC),
                local_date=local_date,
                minutes=minutes,
            )
        )
        await session.commit()
    return session_id


async def fetch(model: Any, pk: Any) -> Any:
    """Read a row back through a fresh session (READ COMMITTED sees the API's commit)."""
    async with TestSession() as session:
        return await session.get(model, pk)


async def count(model: Any) -> int:
    async with TestSession() as session:
        return await session.scalar(select(func.count()).select_from(model)) or 0


async def seed_auth_user(*, user_id: str, email: str, name: str = "Test User") -> str:
    """Insert a row into better-auth's `user` table.

    better-auth owns that table (its own CLI migrates it), so it is not in `Base.metadata` and
    the autouse truncate fixture never clears it — hence the explicit upsert here and the
    cleanup helper below. Tests need it because member listing and invite acceptance resolve
    emails through it (app/auth_users.py).
    """
    async with TestSession() as session:
        await session.execute(
            text(
                'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")'
                " VALUES (:id, :name, :email, false, now(), now())"
                " ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name"
            ),
            {"id": user_id, "name": name, "email": email},
        )
        await session.commit()
    return user_id


async def delete_auth_users(*user_ids: str) -> None:
    """Remove seeded better-auth users so they don't leak between tests."""
    if not user_ids:
        return
    async with TestSession() as session:
        await session.execute(
            text('DELETE FROM "user" WHERE id = ANY(:ids)'), {"ids": list(user_ids)}
        )
        await session.commit()
