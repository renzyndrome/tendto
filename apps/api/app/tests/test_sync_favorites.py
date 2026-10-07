"""POST /sync/upload for `favorites` — a user's starred pages and collections.

Favorites are personal: they ride the `user_private` bucket and are authorized by owner, like
focus sessions. A teammate shares the pages but never sees, or edits, which ones you starred.
"""

from typing import Any
from uuid import UUID, uuid4

from httpx import AsyncClient
from sqlalchemy import select

from app.models.core import Favorite
from app.tests.support import TEST_USER_ID, TestSession, fetch

T1 = "2026-10-07T10:00:00+00:00"


def _batch(op: str, id_: Any, data: dict[str, Any] | None = None) -> dict[str, Any]:
    entry: dict[str, Any] = {"op": op, "table": "favorites", "id": str(id_)}
    if data is not None:
        entry["data"] = data
    return {"entries": [entry]}


def _favorite(target_id: UUID, kind: str = "page", user_id: str = TEST_USER_ID) -> dict[str, Any]:
    return {"user_id": user_id, "target_kind": kind, "target_id": str(target_id), "updated_at": T1}


async def test_star_a_page_without_any_membership(client: AsyncClient) -> None:
    favorite_id, page_id = uuid4(), uuid4()

    res = await client.post("/sync/upload", json=_batch("PUT", favorite_id, _favorite(page_id)))

    assert res.status_code == 200
    stored = await fetch(Favorite, favorite_id)
    assert stored is not None
    assert stored.user_id == TEST_USER_ID
    assert stored.target_id == page_id
    assert stored.target_kind == "page"


async def test_a_client_supplied_user_id_is_ignored(client: AsyncClient) -> None:
    """A new row's owner is the token subject, whatever the payload says."""
    favorite_id = uuid4()
    data = _favorite(uuid4(), user_id="someone_else")

    res = await client.post("/sync/upload", json=_batch("PUT", favorite_id, data))

    assert res.status_code == 200
    stored = await fetch(Favorite, favorite_id)
    assert stored is not None
    assert stored.user_id == TEST_USER_ID


async def test_cannot_touch_another_users_favorite(client: AsyncClient) -> None:
    favorite_id = uuid4()
    async with TestSession() as session:
        session.add(
            Favorite(id=favorite_id, user_id="user_other", target_kind="page", target_id=uuid4())
        )
        await session.commit()

    put = await client.post("/sync/upload", json=_batch("PUT", favorite_id, _favorite(uuid4())))
    delete = await client.post("/sync/upload", json=_batch("DELETE", favorite_id))

    assert put.status_code == 403
    assert delete.status_code == 403
    async with TestSession() as session:
        owner = await session.scalar(select(Favorite.user_id).where(Favorite.id == favorite_id))
    assert owner == "user_other"


async def test_unstar_deletes_own_favorite(client: AsyncClient) -> None:
    favorite_id = uuid4()
    await client.post("/sync/upload", json=_batch("PUT", favorite_id, _favorite(uuid4())))

    res = await client.post("/sync/upload", json=_batch("DELETE", favorite_id))

    assert res.status_code == 200
    assert await fetch(Favorite, favorite_id) is None
