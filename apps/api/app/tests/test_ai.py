"""POST /ai/daily-summary and build_daily_summary — the one ambient AI feature, offline.

Every test runs with the default empty ai_api_key, so `get_provider()` yields the offline
FallbackProvider and nothing touches the network.
"""

from datetime import UTC, date, datetime
from uuid import UUID, uuid4

from httpx import AsyncClient

from app.ai.provider import get_provider
from app.ai.summary import build_daily_summary
from app.main import app
from app.models.core import Collection, Item, Page
from app.tests.support import TEST_USER_ID, TestSession, seed_membership

DAY = date(2026, 7, 9)


async def _seed_day_activity(workspace_id: UUID, day: date = DAY) -> None:
    """One updated page, one completed task, one still-open task — all stamped at noon UTC."""
    at = datetime(day.year, day.month, day.day, 12, 0, tzinfo=UTC)
    async with TestSession() as session:
        session.add(
            Page(
                id=uuid4(),
                workspace_id=workspace_id,
                title="Weekly Plan",
                position=0,
                created_at=at,
                updated_at=at,
            )
        )
        collection_id = uuid4()
        session.add(
            Collection(
                id=collection_id,
                workspace_id=workspace_id,
                name="Tasks",
                default_view="checklist",
                created_at=at,
                updated_at=at,
            )
        )
        await session.flush()  # collection must land before the items reference it
        session.add(
            Item(
                id=uuid4(),
                workspace_id=workspace_id,
                collection_id=collection_id,
                properties={"title": "Ship the API", "status": "done"},
                position=0,
                created_at=at,
                updated_at=at,
            )
        )
        session.add(
            Item(
                id=uuid4(),
                workspace_id=workspace_id,
                collection_id=collection_id,
                properties={"title": "Draft roadmap", "status": "todo"},
                position=1,
                created_at=at,
                updated_at=at,
            )
        )
        await session.commit()


# --- service ----------------------------------------------------------------------------


async def test_build_daily_summary_reflects_activity() -> None:
    ws = await seed_membership(user_id=TEST_USER_ID)
    await _seed_day_activity(ws)

    async with TestSession() as session:
        summary = await build_daily_summary(session, TEST_USER_ID, DAY)

    assert summary.strip()
    assert "Ship the API" in summary  # completed task
    assert "Draft roadmap" in summary  # task added today
    assert "Weekly Plan" in summary  # page updated today


async def test_build_daily_summary_empty_day_is_calm() -> None:
    await seed_membership(user_id=TEST_USER_ID)  # member, but no activity

    async with TestSession() as session:
        summary = await build_daily_summary(session, TEST_USER_ID, DAY)

    assert summary.strip()
    assert "calm" in summary.lower()


async def test_build_daily_summary_scopes_to_member_workspaces() -> None:
    # Activity lives in a workspace the user is NOT a member of; it must not leak in.
    await seed_membership(user_id=TEST_USER_ID)
    foreign_ws = await seed_membership(user_id="other_user")
    await _seed_day_activity(foreign_ws)

    async with TestSession() as session:
        summary = await build_daily_summary(session, TEST_USER_ID, DAY)

    assert "Ship the API" not in summary
    assert "calm" in summary.lower()


# --- endpoint ---------------------------------------------------------------------------


async def test_daily_summary_endpoint_returns_summary(client: AsyncClient) -> None:
    ws = await seed_membership(user_id=TEST_USER_ID)
    await _seed_day_activity(ws)

    res = await client.post("/ai/daily-summary", json={"date": DAY.isoformat()})

    assert res.status_code == 200
    body = res.json()
    assert body["date"] == DAY.isoformat()
    assert "Ship the API" in body["summary"]


async def test_daily_summary_endpoint_defaults_to_today(client: AsyncClient) -> None:
    await seed_membership(user_id=TEST_USER_ID)

    res = await client.post("/ai/daily-summary")  # no body → today (UTC)

    assert res.status_code == 200
    body = res.json()
    assert body["date"] == datetime.now(UTC).date().isoformat()
    assert body["summary"].strip()


async def test_daily_summary_endpoint_uses_injected_provider(client: AsyncClient) -> None:
    await seed_membership(user_id=TEST_USER_ID)

    class StubProvider:
        async def complete(self, system: str, user: str) -> str:
            return "STUBBED SUMMARY"

    app.dependency_overrides[get_provider] = lambda: StubProvider()
    try:
        res = await client.post("/ai/daily-summary", json={"date": DAY.isoformat()})
    finally:
        app.dependency_overrides.pop(get_provider, None)

    assert res.status_code == 200
    assert res.json()["summary"] == "STUBBED SUMMARY"
