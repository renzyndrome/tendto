"""POST /ai/daily-summary and build_daily_summary — the one ambient AI feature, offline.

Every test runs with AI_CLI and AI_API_KEY forced empty (app/tests/__init__.py), so
`get_provider()` yields the offline FallbackProvider and nothing touches the network or a CLI —
regardless of what the developer's .env enables.
"""

from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

from httpx import AsyncClient

from app.ai.provider import get_provider
from app.ai.summary import build_daily_summary
from app.main import app
from app.models.core import Collection, Item, Page
from app.tests.support import (
    TEST_USER_ID,
    TestSession,
    seed_focus_session,
    seed_membership,
)

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


async def _seed_due_item(workspace_id: UUID, title: str, due: str, status: str = "todo") -> None:
    """One item with a `due` property, in its own collection (items need the FK).

    Created WELL BEFORE the summarized day, so these never leak into "Tasks added" — the tests
    below are about the due sections, not the activity ones."""
    at = datetime(DAY.year, DAY.month, DAY.day, 8, 0, tzinfo=UTC) - timedelta(days=30)
    async with TestSession() as session:
        collection_id = uuid4()
        session.add(
            Collection(
                id=collection_id,
                workspace_id=workspace_id,
                name="Due",
                default_view="board",
                created_at=at,
                updated_at=at,
            )
        )
        await session.flush()
        session.add(
            Item(
                id=uuid4(),
                workspace_id=workspace_id,
                collection_id=collection_id,
                properties={"title": title, "status": status, "due": due},
                position=0,
                created_at=at,
                updated_at=at,
            )
        )
        await session.commit()


async def test_summary_recommends_overdue_and_due_next() -> None:
    """The forward-looking half: overdue and next-two-days items land in the digest with their
    dates, so "Tomorrow" can recommend by name — while done, far-future and foreign-workspace
    items stay out."""
    ws = await seed_membership(user_id=TEST_USER_ID)
    await _seed_due_item(ws, "Renew the domain", "2026-07-07")  # overdue (DAY is 07-09)
    await _seed_due_item(ws, "Write the migration", "2026-07-10T09:00")  # due tomorrow, timed
    await _seed_due_item(ws, "Ship v1", "2026-09-01")  # far future — not "next"
    await _seed_due_item(ws, "Old but done", "2026-07-01", status="done")  # done — never nagged
    foreign = await seed_membership(user_id="other_user")
    await _seed_due_item(foreign, "Their secret deadline", "2026-07-07")

    async with TestSession() as session:
        summary = await build_daily_summary(session, TEST_USER_ID, DAY)

    assert "Renew the domain (2026-07-07)" in summary
    assert "Write the migration (2026-07-10)" in summary
    assert "Ship v1" not in summary
    assert "Old but done" not in summary
    assert "Their secret deadline" not in summary


async def test_an_idle_day_with_deadlines_is_not_calm() -> None:
    """No activity at all, but something overdue: the recap must surface it rather than
    declaring a calm day over a missed deadline."""
    ws = await seed_membership(user_id=TEST_USER_ID)
    await _seed_due_item(ws, "Renew the domain", "2026-07-07")

    async with TestSession() as session:
        summary = await build_daily_summary(session, TEST_USER_ID, DAY)

    assert "calm" not in summary.lower()
    assert "Renew the domain" in summary


async def test_build_daily_summary_counts_focus_time() -> None:
    """Focus sessions are user-owned, so they land in the recap with no workspace involved."""
    await seed_focus_session(user_id=TEST_USER_ID, local_date=DAY.isoformat(), minutes=25)
    await seed_focus_session(user_id=TEST_USER_ID, local_date=DAY.isoformat(), minutes=50)
    # Another user's session on the same day must not be counted.
    await seed_focus_session(user_id="other_user", local_date=DAY.isoformat(), minutes=999)

    async with TestSession() as session:
        summary = await build_daily_summary(session, TEST_USER_ID, DAY)

    assert "1h 15m" in summary
    assert "2 sessions" in summary
    assert "999" not in summary


async def test_focus_time_alone_is_not_an_empty_day() -> None:
    """A day spent focusing with nothing else tracked still counted as a day."""
    await seed_focus_session(user_id=TEST_USER_ID, local_date=DAY.isoformat(), minutes=25)

    async with TestSession() as session:
        summary = await build_daily_summary(session, TEST_USER_ID, DAY)

    assert "calm" not in summary.lower()


async def test_focus_sessions_use_the_local_day_not_utc() -> None:
    """The row's own `local_date` decides the day — an evening session in a +08:00 zone is
    logged against the day the user actually lived, not the UTC one it fell into."""
    await seed_focus_session(
        user_id=TEST_USER_ID,
        local_date=DAY.isoformat(),
        minutes=25,
        started_at=datetime(2026, 7, 9, 22, 30, tzinfo=UTC),  # UTC-day AFTER a +08:00 evening
    )

    async with TestSession() as session:
        summary = await build_daily_summary(session, TEST_USER_ID, DAY)

    assert "25m" in summary


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
    assert body["start"] == DAY.isoformat()
    assert body["end"] == DAY.isoformat()
    assert "Ship the API" in body["summary"]
    # The structured digest rides along so the UI can style facts instead of parsing prose.
    assert body["engine"] == "offline"
    assert "Ship the API" in body["activity"]["items_completed"]


async def test_daily_summary_endpoint_defaults_to_today(client: AsyncClient) -> None:
    await seed_membership(user_id=TEST_USER_ID)

    res = await client.post("/ai/daily-summary")  # no body → today (UTC)

    assert res.status_code == 200
    body = res.json()
    assert body["end"] == datetime.now(UTC).date().isoformat()
    assert body["summary"].strip()


async def test_daily_summary_endpoint_summarizes_a_range(client: AsyncClient) -> None:
    """A week/month recap is the same digest over a wider window: focus minutes accumulate
    across the local days inside it and stay out for the days beyond it."""
    await seed_membership(user_id=TEST_USER_ID)
    await seed_focus_session(user_id=TEST_USER_ID, local_date="2026-07-06", minutes=25)
    await seed_focus_session(user_id=TEST_USER_ID, local_date="2026-07-09", minutes=50)
    await seed_focus_session(user_id=TEST_USER_ID, local_date="2026-07-20", minutes=999)

    res = await client.post(
        "/ai/daily-summary",
        json={"start": "2026-07-05", "end": "2026-07-11", "today": DAY.isoformat()},
    )

    assert res.status_code == 200
    body = res.json()
    assert body["start"] == "2026-07-05"
    assert body["activity"]["focus_minutes"] == 75
    assert body["activity"]["focus_sessions"] == 2
    assert "2026-07-05 to 2026-07-11" in body["summary"]


async def test_daily_summary_endpoint_all_time_has_no_lower_bound(client: AsyncClient) -> None:
    await seed_membership(user_id=TEST_USER_ID)
    await seed_focus_session(user_id=TEST_USER_ID, local_date="2020-01-01", minutes=25)

    res = await client.post(
        "/ai/daily-summary", json={"end": DAY.isoformat(), "today": DAY.isoformat()}
    )

    assert res.status_code == 200
    body = res.json()
    assert body["start"] is None
    assert body["activity"]["focus_minutes"] == 25


async def test_daily_summary_endpoint_rejects_inverted_range(client: AsyncClient) -> None:
    await seed_membership(user_id=TEST_USER_ID)

    res = await client.post("/ai/daily-summary", json={"start": "2026-07-11", "end": "2026-07-05"})

    assert res.status_code == 422


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
