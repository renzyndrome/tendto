"""Pytest fixtures for the API tests.

- `_create_database` (session): creates the dedicated test database on first use.
- `_prepare_db` (autouse): ensures the schema exists and DELETES every row before each test,
  so tests are isolated and order-independent.
- `client`: an httpx AsyncClient over the ASGI app with `get_session` pointed at the test DB
  and `get_current_user` overridden to a fixed test user. AsyncClient (not the sync
  TestClient) keeps the request on the same event loop as the test — required because the
  write path uses async SQLAlchemy sessions.

The wiping is why `support.py` refuses to run against the database in DATABASE_URL: this
suite is destructive by design and must never be pointed at real work.
"""

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, text

from app.auth import CurrentUser, get_current_user
from app.db import get_session
from app.main import app
from app.models import Base
from app.tests.support import (
    AUTH_USER_DDL,
    TEST_USER_ID,
    TestSession,
    engine,
    ensure_test_database,
)


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _create_database() -> None:
    await ensure_test_database()
    async with engine.begin() as conn:
        # Rebuild from the models once per run. `create_all` alone only creates MISSING tables,
        # so a column added to an existing model would leave the test database on the old shape
        # and fail with "column ... does not exist". Dropping first keeps the test schema
        # honest without needing migrations here; the database is disposable by construction.
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
        # better-auth's table isn't in Base.metadata — see AUTH_USER_DDL.
        await conn.execute(text(AUTH_USER_DDL))
    yield


@pytest_asyncio.fixture(autouse=True)
async def _prepare_db(_create_database: None) -> None:
    async with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(delete(table))
    yield


@pytest_asyncio.fixture
async def client() -> AsyncClient:
    async def _get_session_override():
        async with TestSession() as session:
            yield session

    def _get_user_override() -> CurrentUser:
        return CurrentUser(id=TEST_USER_ID)

    app.dependency_overrides[get_session] = _get_session_override
    app.dependency_overrides[get_current_user] = _get_user_override
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as http_client:
        yield http_client
    app.dependency_overrides.clear()
