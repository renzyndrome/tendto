"""Pytest fixtures for the API tests.

- `_prepare_db` (autouse): ensures the schema exists and truncates every table before each
  test, so tests are isolated and order-independent.
- `client`: an httpx AsyncClient over the ASGI app with `get_session` pointed at the test DB
  and `get_current_user` overridden to a fixed test user. AsyncClient (not the sync
  TestClient) keeps the request on the same event loop as the test — required because the
  write path uses async SQLAlchemy sessions.
"""

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete

from app.auth import CurrentUser, get_current_user
from app.db import get_session
from app.main import app
from app.models import Base
from app.tests.support import TEST_USER_ID, TestSession, engine


@pytest_asyncio.fixture(autouse=True)
async def _prepare_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
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
