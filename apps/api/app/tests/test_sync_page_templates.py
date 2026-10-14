"""POST /sync/upload for `page_templates` — page templates a user made.

Templates are personal: they ride the `user_private` bucket and are authorized by owner, like
favorites. A teammate shares the pages but never sees, or edits, someone's templates.
"""

import json
from typing import Any
from uuid import uuid4

from httpx import AsyncClient
from sqlalchemy import select

from app.models.core import PageTemplate
from app.tests.support import TEST_USER_ID, TestSession, fetch

T1 = "2026-10-13T10:00:00+00:00"
T2 = "2026-10-13T11:00:00+00:00"
BODY = json.dumps([{"type": "heading", "props": {"level": 2}, "content": "Agenda"}])


def _batch(op: str, id_: Any, data: dict[str, Any] | None = None) -> dict[str, Any]:
    entry: dict[str, Any] = {"op": op, "table": "page_templates", "id": str(id_)}
    if data is not None:
        entry["data"] = data
    return {"entries": [entry]}


def _template(
    name: str = "Weekly review",
    content: str = BODY,
    user_id: str = TEST_USER_ID,
    updated_at: str = T1,
) -> dict[str, Any]:
    return {"user_id": user_id, "name": name, "content": content, "updated_at": updated_at}


async def test_create_a_template_without_any_membership(client: AsyncClient) -> None:
    template_id = uuid4()

    res = await client.post("/sync/upload", json=_batch("PUT", template_id, _template()))

    assert res.status_code == 200
    stored = await fetch(PageTemplate, template_id)
    assert stored is not None
    assert stored.user_id == TEST_USER_ID
    assert stored.name == "Weekly review"
    # Stored as the text that was sent, not parsed: the client reads back the same string.
    assert stored.content == BODY


async def test_a_client_supplied_user_id_is_ignored(client: AsyncClient) -> None:
    """A new row's owner is the token subject, whatever the payload says."""
    template_id = uuid4()

    res = await client.post(
        "/sync/upload", json=_batch("PUT", template_id, _template(user_id="someone_else"))
    )

    assert res.status_code == 200
    stored = await fetch(PageTemplate, template_id)
    assert stored is not None
    assert stored.user_id == TEST_USER_ID


async def test_a_put_missing_columns_still_inserts(client: AsyncClient) -> None:
    """A PUT without name or content must not fail the batch: that wedges the upload queue."""
    template_id = uuid4()

    res = await client.post("/sync/upload", json=_batch("PUT", template_id, {"updated_at": T1}))

    assert res.status_code == 200
    stored = await fetch(PageTemplate, template_id)
    assert stored is not None
    assert stored.name == ""
    assert stored.content == "[]"


async def test_editing_a_template_replaces_its_body(client: AsyncClient) -> None:
    template_id = uuid4()
    await client.post("/sync/upload", json=_batch("PUT", template_id, _template()))
    edited = json.dumps([{"type": "paragraph", "content": "Changed"}])

    res = await client.post(
        "/sync/upload",
        json=_batch("PATCH", template_id, {"content": edited, "name": "Renamed", "updated_at": T2}),
    )

    assert res.status_code == 200
    stored = await fetch(PageTemplate, template_id)
    assert stored is not None
    assert stored.name == "Renamed"
    assert stored.content == edited


async def test_cannot_touch_another_users_template(client: AsyncClient) -> None:
    template_id = uuid4()
    async with TestSession() as session:
        session.add(PageTemplate(id=template_id, user_id="user_other", name="Theirs", content=BODY))
        await session.commit()

    put = await client.post("/sync/upload", json=_batch("PUT", template_id, _template()))
    delete = await client.post("/sync/upload", json=_batch("DELETE", template_id))

    assert put.status_code == 403
    assert delete.status_code == 403
    async with TestSession() as session:
        row = (
            await session.execute(
                select(PageTemplate.user_id, PageTemplate.name).where(
                    PageTemplate.id == template_id
                )
            )
        ).one()
    assert tuple(row) == ("user_other", "Theirs")


async def test_delete_own_template(client: AsyncClient) -> None:
    template_id = uuid4()
    await client.post("/sync/upload", json=_batch("PUT", template_id, _template()))

    res = await client.post("/sync/upload", json=_batch("DELETE", template_id))

    assert res.status_code == 200
    assert await fetch(PageTemplate, template_id) is None


async def test_a_deleted_builtin_is_recorded_as_a_hidden_row(client: AsyncClient) -> None:
    """A built-in lives in client code, so deleting it is a row that says so, synced like any
    other: an integer `hidden` from the replica binds as is."""
    template_id = uuid4()
    data = {**_template(name="Meeting notes", content="[]"), "builtin_id": "meeting-notes"}

    res = await client.post("/sync/upload", json=_batch("PUT", template_id, {**data, "hidden": 1}))

    assert res.status_code == 200
    stored = await fetch(PageTemplate, template_id)
    assert stored is not None
    assert stored.builtin_id == "meeting-notes"
    assert stored.hidden == 1


async def test_a_custom_template_has_no_builtin_and_is_shown(client: AsyncClient) -> None:
    template_id = uuid4()

    await client.post("/sync/upload", json=_batch("PUT", template_id, _template()))

    stored = await fetch(PageTemplate, template_id)
    assert stored is not None
    assert stored.builtin_id is None
    assert stored.hidden == 0
