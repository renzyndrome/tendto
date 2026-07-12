"""POST /sync/upload — the trust boundary: permission checks and idempotent LWW writes."""

from typing import Any
from uuid import UUID, uuid4

from httpx import AsyncClient

from app.models.core import Block, Page
from app.tests.support import TEST_USER_ID, fetch, seed_membership, seed_page

# Ordered edit timestamps (client-supplied `updated_at` values).
T1 = "2026-07-09T10:00:00+00:00"
T2 = "2026-07-09T11:00:00+00:00"
T3 = "2026-07-09T12:00:00+00:00"


def _batch(
    op: str,
    table: str,
    id_: Any,
    data: dict[str, Any] | None = None,
    last_seen: str | None = None,
) -> dict[str, Any]:
    entry: dict[str, Any] = {"op": op, "table": table, "id": str(id_)}
    if data is not None:
        entry["data"] = data
    if last_seen is not None:
        entry["last_seen_updated_at"] = last_seen
    return {"entries": [entry]}


def _page_data(workspace_id: UUID, *, title: str, updated_at: str, position: int = 0) -> dict:
    return {
        "workspace_id": str(workspace_id),
        "title": title,
        "position": position,
        "updated_at": updated_at,
    }


# --- happy-path writes ------------------------------------------------------------------


async def test_put_inserts_page(client: AsyncClient) -> None:
    ws = await seed_membership(user_id=TEST_USER_ID, role="owner")
    page_id = uuid4()

    res = await client.post(
        "/sync/upload",
        json=_batch("PUT", "pages", page_id, _page_data(ws, title="Hello", updated_at=T2)),
    )

    assert res.status_code == 200
    assert res.json() == {"applied": 1, "conflicts": []}
    page = await fetch(Page, page_id)
    assert page is not None
    assert page.title == "Hello"
    assert page.workspace_id == ws


async def test_put_block_parses_jsonb_content(client: AsyncClient) -> None:
    ws = await seed_membership(user_id=TEST_USER_ID)
    page_id = await seed_page(workspace_id=ws)
    block_id = "block-abc123"  # BlockNote-owned string id, not a UUID
    data = {
        "workspace_id": str(ws),
        "page_id": str(page_id),
        "type": "paragraph",
        "content": '{"text": "hi", "level": 2}',  # JSONB arrives as a JSON string
        "position": 0,
        "updated_at": T2,
    }

    res = await client.post("/sync/upload", json=_batch("PUT", "blocks", block_id, data))

    assert res.status_code == 200
    assert res.json()["applied"] == 1
    block = await fetch(Block, block_id)
    assert block is not None
    assert block.content == {"text": "hi", "level": 2}


async def test_editor_can_write(client: AsyncClient) -> None:
    ws = await seed_membership(user_id=TEST_USER_ID, role="editor")
    page_id = uuid4()

    res = await client.post(
        "/sync/upload",
        json=_batch("PUT", "pages", page_id, _page_data(ws, title="ok", updated_at=T2)),
    )

    assert res.status_code == 200
    assert res.json()["applied"] == 1


# --- idempotency ------------------------------------------------------------------------


async def test_put_is_idempotent_on_replay(client: AsyncClient) -> None:
    ws = await seed_membership(user_id=TEST_USER_ID)
    page_id = uuid4()
    payload = _batch("PUT", "pages", page_id, _page_data(ws, title="Hello", updated_at=T2))

    first = await client.post("/sync/upload", json=payload)
    second = await client.post("/sync/upload", json=payload)  # replay identical entry

    assert first.status_code == second.status_code == 200
    page = await fetch(Page, page_id)
    assert page is not None
    assert page.title == "Hello"


# --- last-write-wins --------------------------------------------------------------------


async def test_lww_older_incoming_rejected(client: AsyncClient) -> None:
    ws = await seed_membership(user_id=TEST_USER_ID)
    page_id = uuid4()
    await client.post(
        "/sync/upload",
        json=_batch("PUT", "pages", page_id, _page_data(ws, title="v2", updated_at=T2)),
    )

    res = await client.post(
        "/sync/upload",
        json=_batch(
            "PUT", "pages", page_id, _page_data(ws, title="v1", updated_at=T1), last_seen=T1
        ),
    )

    assert res.status_code == 200
    assert res.json() == {"applied": 0, "conflicts": [str(page_id)]}
    page = await fetch(Page, page_id)
    assert page.title == "v2"  # stale write dropped, server value kept


async def test_lww_newer_incoming_applied(client: AsyncClient) -> None:
    ws = await seed_membership(user_id=TEST_USER_ID)
    page_id = uuid4()
    await client.post(
        "/sync/upload",
        json=_batch("PUT", "pages", page_id, _page_data(ws, title="v2", updated_at=T2)),
    )

    res = await client.post(
        "/sync/upload",
        json=_batch(
            "PUT", "pages", page_id, _page_data(ws, title="v3", updated_at=T3), last_seen=T2
        ),
    )

    assert res.status_code == 200
    assert res.json() == {"applied": 1, "conflicts": []}
    page = await fetch(Page, page_id)
    assert page.title == "v3"


async def test_lww_applied_but_conflict_flagged(client: AsyncClient) -> None:
    # Client edited from a stale base (last_seen T1) yet its edit time (T3) is newest: the
    # write still wins the row, but the conflict is reported so the client can show a notice.
    ws = await seed_membership(user_id=TEST_USER_ID)
    page_id = uuid4()
    await client.post(
        "/sync/upload",
        json=_batch("PUT", "pages", page_id, _page_data(ws, title="v2", updated_at=T2)),
    )

    res = await client.post(
        "/sync/upload",
        json=_batch(
            "PUT", "pages", page_id, _page_data(ws, title="v3", updated_at=T3), last_seen=T1
        ),
    )

    assert res.json()["conflicts"] == [str(page_id)]
    page = await fetch(Page, page_id)
    assert page.title == "v3"


async def test_patch_updates_only_provided_columns(client: AsyncClient) -> None:
    ws = await seed_membership(user_id=TEST_USER_ID)
    page_id = uuid4()
    await client.post(
        "/sync/upload",
        json=_batch(
            "PUT", "pages", page_id, _page_data(ws, title="orig", updated_at=T2, position=5)
        ),
    )

    res = await client.post(
        "/sync/upload",
        json=_batch(
            "PATCH",
            "pages",
            page_id,
            {"workspace_id": str(ws), "title": "renamed", "updated_at": T3},
            last_seen=T2,
        ),
    )

    assert res.status_code == 200
    page = await fetch(Page, page_id)
    assert page.title == "renamed"
    assert page.position == 5  # untouched by the partial update


# --- delete -----------------------------------------------------------------------------


async def test_delete_removes_row_and_is_idempotent(client: AsyncClient) -> None:
    ws = await seed_membership(user_id=TEST_USER_ID)
    page_id = uuid4()
    await client.post(
        "/sync/upload",
        json=_batch("PUT", "pages", page_id, _page_data(ws, title="doomed", updated_at=T2)),
    )

    res = await client.post("/sync/upload", json=_batch("DELETE", "pages", page_id))
    assert res.status_code == 200
    assert res.json() == {"applied": 1, "conflicts": []}
    assert await fetch(Page, page_id) is None

    # Replaying a delete for an already-gone row must stay a no-op success (idempotent),
    # never a 403 or 500 — otherwise the client's upload queue would wedge.
    replay = await client.post("/sync/upload", json=_batch("DELETE", "pages", page_id))
    assert replay.status_code == 200
    assert await fetch(Page, page_id) is None


# --- permission boundary ----------------------------------------------------------------


async def test_non_member_forbidden(client: AsyncClient) -> None:
    ws = await seed_membership(user_id="someone_else", role="owner")
    page_id = uuid4()

    res = await client.post(
        "/sync/upload",
        json=_batch("PUT", "pages", page_id, _page_data(ws, title="nope", updated_at=T2)),
    )

    assert res.status_code == 403
    assert await fetch(Page, page_id) is None


async def test_viewer_forbidden(client: AsyncClient) -> None:
    ws = await seed_membership(user_id=TEST_USER_ID, role="viewer")
    page_id = uuid4()

    res = await client.post(
        "/sync/upload",
        json=_batch("PUT", "pages", page_id, _page_data(ws, title="nope", updated_at=T2)),
    )

    assert res.status_code == 403
    assert await fetch(Page, page_id) is None


async def test_member_cannot_write_foreign_workspace(client: AsyncClient) -> None:
    # The authed user owns their own workspace but is not a member of `other_ws`.
    await seed_membership(user_id=TEST_USER_ID, role="owner")
    other_ws = await seed_membership(user_id="other_user", role="owner")
    page_id = uuid4()

    res = await client.post(
        "/sync/upload",
        json=_batch("PUT", "pages", page_id, _page_data(other_ws, title="intrude", updated_at=T2)),
    )

    assert res.status_code == 403
    assert await fetch(Page, page_id) is None


async def test_cannot_move_row_across_tenants(client: AsyncClient) -> None:
    # The user belongs to BOTH workspaces. A page created in ws_a cannot be relocated to
    # ws_b by a write that supplies a foreign workspace_id: permission is checked against the
    # *stored* tenant (ws_a), and a row's tenant is immutable — only other columns update.
    ws_a = await seed_membership(user_id=TEST_USER_ID, role="owner")
    ws_b = await seed_membership(user_id=TEST_USER_ID, role="owner", name="Other")
    page_id = uuid4()
    await client.post(
        "/sync/upload",
        json=_batch("PUT", "pages", page_id, _page_data(ws_a, title="orig", updated_at=T1)),
    )

    res = await client.post(
        "/sync/upload",
        json=_batch(
            "PUT", "pages", page_id, _page_data(ws_b, title="moved?", updated_at=T3), last_seen=T2
        ),
    )

    assert res.status_code == 200
    page = await fetch(Page, page_id)
    assert page is not None
    assert page.workspace_id == ws_a  # tenant unchanged — cross-tenant move blocked
    assert page.title == "moved?"  # non-tenant columns still updated


async def test_batch_rolls_back_when_one_entry_forbidden(client: AsyncClient) -> None:
    # A mixed batch: a legal write followed by a forbidden one. The 403 must roll back the
    # whole batch — nothing partially commits.
    ws = await seed_membership(user_id=TEST_USER_ID, role="owner")
    foreign_ws = await seed_membership(user_id="other_user", role="owner")
    ok_id, bad_id = uuid4(), uuid4()

    res = await client.post(
        "/sync/upload",
        json={
            "entries": [
                {
                    "op": "PUT",
                    "table": "pages",
                    "id": str(ok_id),
                    "data": _page_data(ws, title="ok", updated_at=T2),
                },
                {
                    "op": "PUT",
                    "table": "pages",
                    "id": str(bad_id),
                    "data": _page_data(foreign_ws, title="bad", updated_at=T2),
                },
            ]
        },
    )

    assert res.status_code == 403
    assert await fetch(Page, ok_id) is None  # first write rolled back
    assert await fetch(Page, bad_id) is None
