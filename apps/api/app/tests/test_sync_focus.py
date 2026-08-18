"""POST /sync/upload for `focus_sessions` — the first USER-owned synced table.

Its whole reason for existing is privacy: focus history must never ride a workspace bucket,
where it would sync onto every teammate's device. So the authorization path here is ownership,
not membership, and these tests pin that down: a user writes their own rows without any
membership at all, and cannot touch anyone else's.
"""

from typing import Any
from uuid import UUID, uuid4

from httpx import AsyncClient

from app.models.core import FocusSession
from app.tests.support import TEST_USER_ID, fetch, seed_focus_session

OTHER_USER_ID = "user_test_2"

T1 = "2026-08-18T10:00:00+00:00"
T2 = "2026-08-18T11:00:00+00:00"


def _batch(op: str, id_: Any, data: dict[str, Any] | None = None) -> dict[str, Any]:
    entry: dict[str, Any] = {"op": op, "table": "focus_sessions", "id": str(id_)}
    if data is not None:
        entry["data"] = data
    return {"entries": [entry]}


def _session_data(
    *,
    updated_at: str = T2,
    minutes: int = 25,
    local_date: str = "2026-08-18",
    started_at: str = "2026-08-18T09:00:00+00:00",
    user_id: str | None = None,
) -> dict[str, Any]:
    data: dict[str, Any] = {
        "started_at": started_at,
        "local_date": local_date,
        "minutes": minutes,
        "updated_at": updated_at,
    }
    if user_id is not None:
        data["user_id"] = user_id
    return data


async def test_writes_without_any_membership(client: AsyncClient) -> None:
    """No workspace, no membership — and the write still lands.

    Proves the workspace path is BYPASSED rather than merely satisfied: every other table would
    403 here with no membership row to check.
    """
    session_id = uuid4()

    res = await client.post("/sync/upload", json=_batch("PUT", session_id, _session_data()))

    assert res.status_code == 200
    assert res.json() == {"applied": 1, "conflicts": []}
    row = await fetch(FocusSession, session_id)
    assert row is not None
    assert row.user_id == TEST_USER_ID
    assert row.minutes == 25
    assert row.local_date == "2026-08-18"


async def test_started_at_iso_string_is_parsed(client: AsyncClient) -> None:
    """The client sends `started_at` as an ISO string; asyncpg only binds datetimes.

    Without the DATETIME_COLUMNS parse this is a 500 — and because the client's upload queue is
    ordered and its transaction is never completed on error, that 500 would wedge every
    subsequent write from that device. Hence a test of its own.
    """
    session_id = uuid4()

    res = await client.post(
        "/sync/upload",
        json=_batch("PUT", session_id, _session_data(started_at="2026-08-18T21:30:00+02:00")),
    )

    assert res.status_code == 200
    row = await fetch(FocusSession, session_id)
    assert row is not None
    assert row.started_at.utcoffset() is not None  # stored as a real timestamptz, not a string
    assert row.started_at.isoformat() == "2026-08-18T19:30:00+00:00"


async def test_user_id_is_pinned_to_token_subject(client: AsyncClient) -> None:
    """A client-supplied `user_id` is ignored — the row belongs to whoever holds the token."""
    session_id = uuid4()

    res = await client.post(
        "/sync/upload",
        json=_batch("PUT", session_id, _session_data(user_id=OTHER_USER_ID)),
    )

    assert res.status_code == 200
    row = await fetch(FocusSession, session_id)
    assert row is not None
    assert row.user_id == TEST_USER_ID


async def test_cannot_write_another_users_session(client: AsyncClient) -> None:
    session_id = await seed_focus_session(user_id=OTHER_USER_ID, minutes=50)

    res = await client.post(
        "/sync/upload", json=_batch("PUT", session_id, _session_data(minutes=1))
    )

    assert res.status_code == 403
    row = await fetch(FocusSession, session_id)
    assert row is not None
    assert row.minutes == 50  # untouched
    assert row.user_id == OTHER_USER_ID


async def test_cannot_delete_another_users_session(client: AsyncClient) -> None:
    session_id = await seed_focus_session(user_id=OTHER_USER_ID)

    res = await client.post("/sync/upload", json=_batch("DELETE", session_id))

    assert res.status_code == 403
    assert await fetch(FocusSession, session_id) is not None


async def test_delete_own_session_replays_idempotently(client: AsyncClient) -> None:
    session_id = await seed_focus_session(user_id=TEST_USER_ID)

    first = await client.post("/sync/upload", json=_batch("DELETE", session_id))
    second = await client.post("/sync/upload", json=_batch("DELETE", session_id))

    assert first.status_code == 200
    assert second.status_code == 200  # replaying the queue is safe
    assert await fetch(FocusSession, session_id) is None


async def test_stale_write_is_dropped(client: AsyncClient) -> None:
    """Last-write-wins still applies — user-owned tables get no special conflict handling."""
    session_id = uuid4()
    await client.post("/sync/upload", json=_batch("PUT", session_id, _session_data(updated_at=T2)))

    res = await client.post(
        "/sync/upload",
        json=_batch("PUT", session_id, _session_data(updated_at=T1, minutes=99)),
    )

    assert res.status_code == 200
    row = await fetch(FocusSession, session_id)
    assert row is not None
    assert row.minutes == 25  # the newer server row survived


async def test_unknown_table_is_rejected(client: AsyncClient) -> None:
    """TABLE_MODELS is the allowlist as well as the dispatch map."""
    res = await client.post(
        "/sync/upload",
        json={"entries": [{"op": "PUT", "table": "secrets", "id": str(uuid4()), "data": {}}]},
    )

    assert res.status_code == 400


async def test_workspace_tables_still_require_membership(client: AsyncClient) -> None:
    """The user-owned branch must not have loosened the workspace path."""
    res = await client.post(
        "/sync/upload",
        json={
            "entries": [
                {
                    "op": "PUT",
                    "table": "pages",
                    "id": str(uuid4()),
                    "data": {
                        "workspace_id": str(UUID(int=1)),
                        "title": "Sneaky",
                        "position": 0,
                        "updated_at": T2,
                    },
                }
            ]
        },
    )

    assert res.status_code == 403
