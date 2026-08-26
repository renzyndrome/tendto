"""POST /sync/upload for `comments` — a workspace table with a SECOND owner: the author.

Comments are team-visible on purpose, so membership is checked exactly as for pages and items.
What is new is that being an editor of the workspace does not let you speak in someone else's
name: only the author may edit their own comment, and only a workspace owner may delete
someone else's (moderation — never editing, which would put words in their mouth).

These tests pin that matrix down, plus the pin that stops a client forging `author_id`.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.exc import IntegrityError

from app.models.core import Comment, Item, Page
from app.tests.support import (
    TEST_USER_ID,
    TestSession,
    add_membership,
    delete_auth_users,
    fetch,
    seed_auth_user,
    seed_comment,
    seed_item,
    seed_membership,
    seed_page,
)

OTHER_USER_ID = "user_test_2"

T1 = "2026-08-20T10:00:00+00:00"
T2 = "2026-08-20T11:00:00+00:00"


def _batch(op: str, id_: Any, data: dict[str, Any] | None = None) -> dict[str, Any]:
    entry: dict[str, Any] = {"op": op, "table": "comments", "id": str(id_)}
    if data is not None:
        entry["data"] = data
    return {"entries": [entry]}


def _comment_data(
    *,
    workspace_id: UUID,
    page_id: UUID | None = None,
    item_id: UUID | None = None,
    body: str = "Looks good",
    author_id: str | None = None,
    author_label: str = "me@example.com",
    updated_at: str = T2,
) -> dict[str, Any]:
    data: dict[str, Any] = {
        "workspace_id": str(workspace_id),
        "page_id": str(page_id) if page_id else None,
        "item_id": str(item_id) if item_id else None,
        "author_label": author_label,
        "body": body,
        "authored_at": T1,
        "updated_at": updated_at,
    }
    if author_id is not None:
        data["author_id"] = author_id
    return data


# --- the happy paths --------------------------------------------------------------------


async def test_member_comments_on_a_page(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="editor")
    page_id = await seed_page(workspace_id=workspace_id)
    comment_id = uuid4()

    res = await client.post(
        "/sync/upload",
        json=_batch("PUT", comment_id, _comment_data(workspace_id=workspace_id, page_id=page_id)),
    )

    assert res.status_code == 200
    row = await fetch(Comment, comment_id)
    assert row is not None
    assert row.page_id == page_id
    assert row.item_id is None
    assert row.author_id == TEST_USER_ID
    assert row.body == "Looks good"


async def test_member_comments_on_a_card(client: AsyncClient) -> None:
    """The same primitive on the other owner — a card, not a page."""
    workspace_id = await seed_membership(user_id=TEST_USER_ID)
    item_id = await seed_item(workspace_id=workspace_id)
    comment_id = uuid4()

    res = await client.post(
        "/sync/upload",
        json=_batch("PUT", comment_id, _comment_data(workspace_id=workspace_id, item_id=item_id)),
    )

    assert res.status_code == 200
    row = await fetch(Comment, comment_id)
    assert row is not None
    assert row.item_id == item_id
    assert row.page_id is None


async def test_author_edits_own_comment(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="editor")
    page_id = await seed_page(workspace_id=workspace_id)
    comment_id = await seed_comment(
        workspace_id=workspace_id, page_id=page_id, author_id=TEST_USER_ID, body="typo"
    )

    res = await client.post(
        "/sync/upload",
        json=_batch(
            "PUT",
            comment_id,
            _comment_data(workspace_id=workspace_id, page_id=page_id, body="fixed"),
        ),
    )

    assert res.status_code == 200
    row = await fetch(Comment, comment_id)
    assert row is not None
    assert row.body == "fixed"


async def test_author_deletes_own_comment(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="editor")
    page_id = await seed_page(workspace_id=workspace_id)
    comment_id = await seed_comment(
        workspace_id=workspace_id, page_id=page_id, author_id=TEST_USER_ID
    )

    first = await client.post("/sync/upload", json=_batch("DELETE", comment_id))
    second = await client.post("/sync/upload", json=_batch("DELETE", comment_id))

    assert first.status_code == 200
    assert second.status_code == 200  # replaying the queue is safe
    assert await fetch(Comment, comment_id) is None


async def test_edited_at_iso_string_is_parsed(client: AsyncClient) -> None:
    """`edited_at` arrives as an ISO string; asyncpg only binds datetimes to a timestamptz.

    Without the DATETIME_COLUMNS parse this is a 500 — and since the client's upload queue is
    ordered and its transaction is never completed on error, that would wedge every subsequent
    write from that device. Same trap as focus_sessions.started_at, hence a test of its own.
    """
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="editor")
    page_id = await seed_page(workspace_id=workspace_id)
    comment_id = await seed_comment(
        workspace_id=workspace_id, page_id=page_id, author_id=TEST_USER_ID
    )

    data = _comment_data(workspace_id=workspace_id, page_id=page_id, body="reworded")
    data["edited_at"] = "2026-08-20T21:30:00+02:00"
    res = await client.post("/sync/upload", json=_batch("PUT", comment_id, data))

    assert res.status_code == 200
    row = await fetch(Comment, comment_id)
    assert row is not None
    assert row.edited_at is not None
    assert row.edited_at.isoformat() == "2026-08-20T19:30:00+00:00"


async def test_authored_at_comes_from_the_client(client: AsyncClient) -> None:
    """The thread sorts and dates by the WRITING DEVICE's clock, not the server's.

    `created_at` is reserved, so the server stamps it at upload time — a comment written offline
    would otherwise claim to have been written the moment the device reconnected, and sort after
    everything said in between.
    """
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="editor")
    page_id = await seed_page(workspace_id=workspace_id)
    comment_id = uuid4()

    data = _comment_data(workspace_id=workspace_id, page_id=page_id)
    data["authored_at"] = "2026-08-17T08:15:00+00:00"  # written days before it uploaded
    res = await client.post("/sync/upload", json=_batch("PUT", comment_id, data))

    assert res.status_code == 200
    row = await fetch(Comment, comment_id)
    assert row is not None
    assert row.authored_at.isoformat() == "2026-08-17T08:15:00+00:00"
    # ...while created_at stayed the server's own bookkeeping.
    assert row.created_at > row.authored_at


async def test_author_label_is_stamped_from_better_auth(client: AsyncClient) -> None:
    """The label is the only identity a reader sees, so the client never gets to choose it."""
    await seed_auth_user(user_id=TEST_USER_ID, email="real@example.com", name="Real Person")
    try:
        workspace_id = await seed_membership(user_id=TEST_USER_ID, role="editor")
        page_id = await seed_page(workspace_id=workspace_id)
        comment_id = uuid4()

        res = await client.post(
            "/sync/upload",
            json=_batch(
                "PUT",
                comment_id,
                _comment_data(
                    workspace_id=workspace_id,
                    page_id=page_id,
                    author_label="Someone Else Entirely",
                ),
            ),
        )

        assert res.status_code == 200
        row = await fetch(Comment, comment_id)
        assert row is not None
        assert row.author_label == "Real Person"
    finally:
        await delete_auth_users(TEST_USER_ID)


async def test_author_label_cannot_be_changed_by_an_edit(client: AsyncClient) -> None:
    """Editing your own comment must not rename its author either."""
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="editor")
    page_id = await seed_page(workspace_id=workspace_id)
    comment_id = await seed_comment(
        workspace_id=workspace_id,
        page_id=page_id,
        author_id=TEST_USER_ID,
        author_label="Original Name",
    )

    res = await client.post(
        "/sync/upload",
        json=_batch(
            "PUT",
            comment_id,
            _comment_data(
                workspace_id=workspace_id, page_id=page_id, author_label="Impostor", body="edited"
            ),
        ),
    )

    assert res.status_code == 200
    row = await fetch(Comment, comment_id)
    assert row is not None
    assert row.author_label == "Original Name"
    assert row.body == "edited"


async def test_a_new_comment_is_not_marked_edited(client: AsyncClient) -> None:
    """`edited_at` stays NULL until someone actually edits — it is never derived."""
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="editor")
    page_id = await seed_page(workspace_id=workspace_id)
    comment_id = uuid4()

    res = await client.post(
        "/sync/upload",
        json=_batch("PUT", comment_id, _comment_data(workspace_id=workspace_id, page_id=page_id)),
    )

    assert res.status_code == 200
    row = await fetch(Comment, comment_id)
    assert row is not None
    assert row.edited_at is None


# --- the author pin ---------------------------------------------------------------------


async def test_author_id_is_pinned_to_token_subject(client: AsyncClient) -> None:
    """A client-supplied `author_id` is ignored: you can only ever post as yourself."""
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="editor")
    page_id = await seed_page(workspace_id=workspace_id)
    comment_id = uuid4()

    res = await client.post(
        "/sync/upload",
        json=_batch(
            "PUT",
            comment_id,
            _comment_data(workspace_id=workspace_id, page_id=page_id, author_id=OTHER_USER_ID),
        ),
    )

    assert res.status_code == 200
    row = await fetch(Comment, comment_id)
    assert row is not None
    assert row.author_id == TEST_USER_ID


async def test_author_id_cannot_be_reassigned_by_an_edit(client: AsyncClient) -> None:
    """Editing your own comment can't hand it to someone else either."""
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="editor")
    page_id = await seed_page(workspace_id=workspace_id)
    comment_id = await seed_comment(
        workspace_id=workspace_id, page_id=page_id, author_id=TEST_USER_ID
    )

    res = await client.post(
        "/sync/upload",
        json=_batch(
            "PUT",
            comment_id,
            _comment_data(workspace_id=workspace_id, page_id=page_id, author_id=OTHER_USER_ID),
        ),
    )

    assert res.status_code == 200
    row = await fetch(Comment, comment_id)
    assert row is not None
    assert row.author_id == TEST_USER_ID


# --- editing someone else's comment -----------------------------------------------------


async def test_editor_cannot_edit_another_members_comment(client: AsyncClient) -> None:
    """Write access to the workspace is not write access to another person's words."""
    workspace_id = await seed_membership(user_id=OTHER_USER_ID, role="owner")
    await add_membership(user_id=TEST_USER_ID, workspace_id=workspace_id, role="editor")
    page_id = await seed_page(workspace_id=workspace_id)
    comment_id = await seed_comment(
        workspace_id=workspace_id, page_id=page_id, author_id=OTHER_USER_ID, body="theirs"
    )

    res = await client.post(
        "/sync/upload",
        json=_batch(
            "PUT",
            comment_id,
            _comment_data(workspace_id=workspace_id, page_id=page_id, body="hijacked"),
        ),
    )

    assert res.status_code == 403
    row = await fetch(Comment, comment_id)
    assert row is not None
    assert row.body == "theirs"  # untouched


async def test_editor_cannot_patch_another_members_comment(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=OTHER_USER_ID, role="owner")
    await add_membership(user_id=TEST_USER_ID, workspace_id=workspace_id, role="editor")
    page_id = await seed_page(workspace_id=workspace_id)
    comment_id = await seed_comment(
        workspace_id=workspace_id, page_id=page_id, author_id=OTHER_USER_ID, body="theirs"
    )

    res = await client.post(
        "/sync/upload",
        json=_batch("PATCH", comment_id, {"body": "hijacked", "updated_at": T2}),
    )

    assert res.status_code == 403
    row = await fetch(Comment, comment_id)
    assert row is not None
    assert row.body == "theirs"


async def test_editor_cannot_delete_another_members_comment(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=OTHER_USER_ID, role="owner")
    await add_membership(user_id=TEST_USER_ID, workspace_id=workspace_id, role="editor")
    page_id = await seed_page(workspace_id=workspace_id)
    comment_id = await seed_comment(
        workspace_id=workspace_id, page_id=page_id, author_id=OTHER_USER_ID
    )

    res = await client.post("/sync/upload", json=_batch("DELETE", comment_id))

    assert res.status_code == 403
    assert await fetch(Comment, comment_id) is not None


# --- what the workspace owner may do ----------------------------------------------------


async def test_owner_may_delete_another_members_comment(client: AsyncClient) -> None:
    """Moderation: the workspace owner can remove anything posted in their workspace."""
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="owner")
    await add_membership(user_id=OTHER_USER_ID, workspace_id=workspace_id, role="editor")
    page_id = await seed_page(workspace_id=workspace_id)
    comment_id = await seed_comment(
        workspace_id=workspace_id, page_id=page_id, author_id=OTHER_USER_ID
    )

    res = await client.post("/sync/upload", json=_batch("DELETE", comment_id))

    assert res.status_code == 200
    assert await fetch(Comment, comment_id) is None


async def test_owner_may_not_edit_another_members_comment(client: AsyncClient) -> None:
    """Deleting is moderation; editing would be impersonation. No role permits it."""
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="owner")
    await add_membership(user_id=OTHER_USER_ID, workspace_id=workspace_id, role="editor")
    page_id = await seed_page(workspace_id=workspace_id)
    comment_id = await seed_comment(
        workspace_id=workspace_id, page_id=page_id, author_id=OTHER_USER_ID, body="theirs"
    )

    res = await client.post(
        "/sync/upload",
        json=_batch(
            "PUT",
            comment_id,
            _comment_data(workspace_id=workspace_id, page_id=page_id, body="rewritten"),
        ),
    )

    assert res.status_code == 403
    row = await fetch(Comment, comment_id)
    assert row is not None
    assert row.body == "theirs"


# --- the workspace boundary is unchanged ------------------------------------------------


async def test_viewer_cannot_comment(client: AsyncClient) -> None:
    """Commenting rides WRITE_ROLES; a read-only member stays read-only (a `commenter` role
    is a later, deliberate decision — docs/planning/05 §3)."""
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="viewer")
    page_id = await seed_page(workspace_id=workspace_id)

    res = await client.post(
        "/sync/upload",
        json=_batch("PUT", uuid4(), _comment_data(workspace_id=workspace_id, page_id=page_id)),
    )

    assert res.status_code == 403


async def test_non_member_cannot_comment(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=OTHER_USER_ID, role="owner")
    page_id = await seed_page(workspace_id=workspace_id)
    comment_id = uuid4()

    res = await client.post(
        "/sync/upload",
        json=_batch("PUT", comment_id, _comment_data(workspace_id=workspace_id, page_id=page_id)),
    )

    assert res.status_code == 403
    assert await fetch(Comment, comment_id) is None


async def test_comment_cannot_be_moved_across_workspaces(client: AsyncClient) -> None:
    """The workspace pin still applies — the author pin is added to it, not instead of it."""
    home_id = await seed_membership(user_id=TEST_USER_ID, role="owner")
    other_id = await seed_membership(user_id=TEST_USER_ID, role="owner", name="Other")
    page_id = await seed_page(workspace_id=home_id)
    comment_id = await seed_comment(workspace_id=home_id, page_id=page_id, author_id=TEST_USER_ID)

    res = await client.post(
        "/sync/upload",
        json=_batch(
            "PUT",
            comment_id,
            _comment_data(workspace_id=other_id, page_id=page_id, body="moved"),
        ),
    )

    assert res.status_code == 200
    row = await fetch(Comment, comment_id)
    assert row is not None
    assert row.workspace_id == home_id  # stayed put


# --- database-level guarantees ----------------------------------------------------------


async def test_deleting_the_page_removes_its_comments(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="owner")
    page_id = await seed_page(workspace_id=workspace_id)
    comment_id = await seed_comment(
        workspace_id=workspace_id, page_id=page_id, author_id=TEST_USER_ID
    )

    res = await client.post(
        "/sync/upload",
        json={"entries": [{"op": "DELETE", "table": "pages", "id": str(page_id)}]},
    )

    assert res.status_code == 200
    assert await fetch(Page, page_id) is None
    assert await fetch(Comment, comment_id) is None  # FK cascade


async def test_an_editor_can_delete_a_page_carrying_someone_elses_comment(
    client: AsyncClient,
) -> None:
    """Deleting the PARENT must never trip the author check.

    The client deliberately does not cascade comments (lib/pages.ts explains why): an editor
    removing a page that holds a teammate's comment would queue a comment DELETE the author
    check answers with 403 — and since the upload queue is ordered and its transaction is not
    completed on error, that permanently wedges every later write from that device. The page
    delete alone must be enough, with Postgres collecting the comments.
    """
    workspace_id = await seed_membership(user_id=OTHER_USER_ID, role="owner")
    await add_membership(user_id=TEST_USER_ID, workspace_id=workspace_id, role="editor")
    page_id = await seed_page(workspace_id=workspace_id)
    comment_id = await seed_comment(
        workspace_id=workspace_id, page_id=page_id, author_id=OTHER_USER_ID
    )

    res = await client.post(
        "/sync/upload",
        json={"entries": [{"op": "DELETE", "table": "pages", "id": str(page_id)}]},
    )

    assert res.status_code == 200
    assert await fetch(Comment, comment_id) is None


async def test_deleting_the_card_removes_its_comments(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="owner")
    item_id = await seed_item(workspace_id=workspace_id)
    comment_id = await seed_comment(
        workspace_id=workspace_id, item_id=item_id, author_id=TEST_USER_ID
    )

    res = await client.post(
        "/sync/upload",
        json={"entries": [{"op": "DELETE", "table": "items", "id": str(item_id)}]},
    )

    assert res.status_code == 200
    assert await fetch(Item, item_id) is None
    assert await fetch(Comment, comment_id) is None  # FK cascade


async def test_a_comment_must_have_exactly_one_owner() -> None:
    """The XOR is a database CHECK, because both columns arrive from a client."""
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="owner")
    page_id = await seed_page(workspace_id=workspace_id)
    item_id = await seed_item(workspace_id=workspace_id)

    with pytest.raises(IntegrityError):
        async with TestSession() as session:
            session.add(
                Comment(
                    id=uuid4(),
                    workspace_id=workspace_id,
                    page_id=page_id,
                    item_id=item_id,  # both owners
                    author_id=TEST_USER_ID,
                    author_label="a@example.com",
                    body="x",
                    authored_at=datetime(2026, 8, 20, 9, 0, tzinfo=UTC),
                )
            )
            await session.commit()

    with pytest.raises(IntegrityError):
        async with TestSession() as session:
            session.add(
                Comment(
                    id=uuid4(),
                    workspace_id=workspace_id,  # neither owner
                    author_id=TEST_USER_ID,
                    author_label="a@example.com",
                    body="x",
                    authored_at=datetime(2026, 8, 20, 9, 0, tzinfo=UTC),
                )
            )
            await session.commit()
