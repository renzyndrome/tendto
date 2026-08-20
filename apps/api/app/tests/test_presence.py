"""POST /presence — "who else is looking at this page".

Two properties are load-bearing here and neither is obvious from reading the endpoint: presence
must stay INSIDE the workspace boundary (knowing a page id must not tell you who is reading it),
and it must never become synced data. The last test pins the second one structurally.
"""

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from httpx import AsyncClient
from sqlalchemy import select, text

from app.models.core import Presence
from app.routers.presence import POLL_ALONE_MS, POLL_TOGETHER_MS, TTL_SECONDS
from app.tests.support import (
    TEST_USER_ID,
    TestSession,
    add_membership,
    delete_auth_users,
    seed_auth_user,
    seed_membership,
)

OTHER_USER_ID = "user_test_2"


def _scope(kind: str = "page", id_: UUID | None = None) -> str:
    return f"{kind}:{id_ or uuid4()}"


def _body(workspace_id: UUID, scope: str) -> dict[str, Any]:
    return {"workspace_id": str(workspace_id), "scope": scope}


async def _seen(*, workspace_id: UUID, scope: str, user_id: str, seen_at: datetime) -> None:
    """Put someone on a page at a given moment, bypassing the endpoint."""
    async with TestSession() as session:
        session.add(
            Presence(workspace_id=workspace_id, scope=scope, user_id=user_id, seen_at=seen_at)
        )
        await session.commit()


async def test_alone_reports_nobody_and_a_lazy_cadence(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID)

    res = await client.post("/presence/heartbeat", json=_body(workspace_id, _scope()))

    assert res.status_code == 200
    assert res.json() == {"others": [], "next_poll_ms": POLL_ALONE_MS}


async def test_sees_a_teammate_on_the_same_page(client: AsyncClient) -> None:
    await seed_auth_user(user_id=OTHER_USER_ID, email="them@example.com", name="Ada Lovelace")
    try:
        workspace_id = await seed_membership(user_id=TEST_USER_ID)
        await add_membership(user_id=OTHER_USER_ID, workspace_id=workspace_id)
        scope = _scope()
        await _seen(
            workspace_id=workspace_id,
            scope=scope,
            user_id=OTHER_USER_ID,
            seen_at=datetime.now(UTC),
        )

        res = await client.post("/presence/heartbeat", json=_body(workspace_id, scope))

        assert res.status_code == 200
        body = res.json()
        # Resolved from better-auth, because names never sync to a device.
        assert body["others"] == [{"user_id": OTHER_USER_ID, "label": "Ada Lovelace"}]
        # Company means watch more closely.
        assert body["next_poll_ms"] == POLL_TOGETHER_MS
    finally:
        await delete_auth_users(OTHER_USER_ID)


async def test_you_are_never_in_your_own_list(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID)
    scope = _scope()

    await client.post("/presence/heartbeat", json=_body(workspace_id, scope))
    res = await client.post("/presence/heartbeat", json=_body(workspace_id, scope))

    assert res.json()["others"] == []


async def test_a_second_tab_does_not_duplicate_you(client: AsyncClient) -> None:
    """One row per (workspace, scope, user) — two tabs on a page is still one person there."""
    workspace_id = await seed_membership(user_id=TEST_USER_ID)
    scope = _scope()

    await client.post("/presence/heartbeat", json=_body(workspace_id, scope))
    await client.post("/presence/heartbeat", json=_body(workspace_id, scope))

    async with TestSession() as session:
        rows = list(await session.scalars(select(Presence.user_id)))
    assert rows == [TEST_USER_ID]


async def test_a_stale_viewer_is_swept_and_not_reported(client: AsyncClient) -> None:
    """A closed laptop sends no goodbye, so the TTL is what makes presence true."""
    workspace_id = await seed_membership(user_id=TEST_USER_ID)
    await add_membership(user_id=OTHER_USER_ID, workspace_id=workspace_id)
    scope = _scope()
    await _seen(
        workspace_id=workspace_id,
        scope=scope,
        user_id=OTHER_USER_ID,
        seen_at=datetime.now(UTC) - timedelta(seconds=TTL_SECONDS + 5),
    )

    res = await client.post("/presence/heartbeat", json=_body(workspace_id, scope))

    assert res.json()["others"] == []
    async with TestSession() as session:
        remaining = list(await session.scalars(select(Presence.user_id)))
    assert remaining == [TEST_USER_ID]  # the ghost was swept, not merely hidden


async def test_a_different_page_is_a_different_room(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID)
    await add_membership(user_id=OTHER_USER_ID, workspace_id=workspace_id)
    await _seen(
        workspace_id=workspace_id,
        scope=_scope(),
        user_id=OTHER_USER_ID,
        seen_at=datetime.now(UTC),
    )

    res = await client.post("/presence/heartbeat", json=_body(workspace_id, _scope()))

    assert res.json()["others"] == []


async def test_non_member_cannot_probe_a_workspace(client: AsyncClient) -> None:
    """Knowing a page's id must not reveal who is reading it."""
    workspace_id = await seed_membership(user_id=OTHER_USER_ID)
    scope = _scope()
    await _seen(
        workspace_id=workspace_id,
        scope=scope,
        user_id=OTHER_USER_ID,
        seen_at=datetime.now(UTC),
    )

    res = await client.post("/presence/heartbeat", json=_body(workspace_id, scope))

    assert res.status_code == 403


async def test_viewers_can_see_who_is_here(client: AsyncClient) -> None:
    """Unlike writing, presence is open to every role — a viewer is reading the same page."""
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="viewer")

    res = await client.post("/presence/heartbeat", json=_body(workspace_id, _scope()))

    assert res.status_code == 200


async def test_leave_clears_you_immediately(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID)
    scope = _scope()
    await client.post("/presence/heartbeat", json=_body(workspace_id, scope))

    res = await client.post("/presence/leave", json=_body(workspace_id, scope))

    assert res.status_code == 204
    async with TestSession() as session:
        assert list(await session.scalars(select(Presence.user_id))) == []


async def test_leave_cannot_evict_someone_else(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID)
    await add_membership(user_id=OTHER_USER_ID, workspace_id=workspace_id)
    scope = _scope()
    await _seen(
        workspace_id=workspace_id,
        scope=scope,
        user_id=OTHER_USER_ID,
        seen_at=datetime.now(UTC),
    )

    await client.post("/presence/leave", json=_body(workspace_id, scope))

    async with TestSession() as session:
        assert list(await session.scalars(select(Presence.user_id))) == [OTHER_USER_ID]


async def test_scope_is_case_folded_so_one_page_is_one_room(client: AsyncClient) -> None:
    """A UUID is not case-sensitive, but a raw lookup key is — two spellings would be two rooms."""
    workspace_id = await seed_membership(user_id=TEST_USER_ID)
    await add_membership(user_id=OTHER_USER_ID, workspace_id=workspace_id)
    page_id = uuid4()
    await _seen(
        workspace_id=workspace_id,
        scope=f"page:{page_id}",  # str(UUID) is lowercase
        user_id=OTHER_USER_ID,
        seen_at=datetime.now(UTC),
    )

    res = await client.post(
        "/presence/heartbeat",
        json=_body(workspace_id, f"page:{page_id}".upper().replace("PAGE", "page")),
    )

    assert res.status_code == 200
    assert [viewer["user_id"] for viewer in res.json()["others"]] == [OTHER_USER_ID]


async def test_a_malformed_scope_is_rejected(client: AsyncClient) -> None:
    """`scope` is a client-supplied lookup key; anything but the two real shapes stays out."""
    workspace_id = await seed_membership(user_id=TEST_USER_ID)

    for bad in ["", "page:not-a-uuid", "secrets:" + str(uuid4()), str(uuid4())]:
        res = await client.post("/presence/heartbeat", json=_body(workspace_id, bad))
        assert res.status_code == 422, bad


async def test_presence_is_unlogged_so_it_can_never_be_replicated() -> None:
    """The one guarantee worth pinning in the database rather than in a convention.

    The PowerSync publication is `FOR ALL TABLES`, so a new table is published automatically —
    a table added to sync-rules.yaml by mistake WOULD reach devices. An unlogged table writes
    no WAL, so logical decoding has nothing to decode and presence cannot be replicated even
    then. If this test ever fails, presence has become synced data.
    """
    async with TestSession() as session:
        # Cast: relpersistence is Postgres's internal "char" type, which asyncpg hands back as
        # bytes rather than str.
        persistence = await session.scalar(
            text("SELECT relpersistence::text FROM pg_class WHERE relname = 'presence'")
        )
    assert persistence == "u", "presence must stay UNLOGGED — see models.core.Presence"
