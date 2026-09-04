"""The RLS backstop actually holds.

These tests are the reason `app/models/rls.py` bothers to create `tendto_app`. The API connects
as the table owner and so bypasses RLS by design (see that module for why forcing it would break
PowerSync), which means the policies would otherwise be entirely unexercised — present in the
schema, believed to work, never once asked a question.

`SET LOCAL ROLE` is what asks. Inside a transaction it switches to the non-owner role, RLS
applies, and the same query the owner answers in full comes back filtered. `SET LOCAL` scopes
both the role and the user setting to the transaction, so a rolled-back test leaks neither.
"""

from uuid import uuid4

import pytest
from sqlalchemy import text

from app.models.rls import APP_ROLE, USER_SETTING
from app.tests.support import (
    TestSession,
    add_membership,
    seed_collection,
    seed_comment,
    seed_focus_session,
    seed_item,
    seed_membership,
    seed_page,
)

ALICE = "user_alice"
BOB = "user_bob"


async def as_app_role(user_id: str | None, sql: str, **params):
    """Run one query as `tendto_app` with `app.current_user_id` set to `user_id`.

    Everything is LOCAL to the transaction, which is then rolled back — so the connection is
    handed back to the pool as the owner with no setting attached.
    """
    async with TestSession() as session:
        # set_config(..., true) is the function form of SET LOCAL, and unlike SET it takes a
        # bind parameter — a user id interpolated into SQL here would be an injection hole in
        # the very test that exists to prove an isolation boundary.
        await session.execute(
            text(f"SELECT set_config('{USER_SETTING}', :uid, true)"),
            {"uid": "" if user_id is None else user_id},
        )
        await session.execute(text(f'SET LOCAL ROLE "{APP_ROLE}"'))
        result = await session.execute(text(sql), params)
        rows = result.fetchall()
        await session.rollback()
        return rows


@pytest.mark.asyncio
async def test_workspace_content_is_invisible_to_a_non_member():
    """The headline claim: another tenant's rows are not merely un-served, they are unreadable."""
    alice_ws = await seed_membership(user_id=ALICE)
    bob_ws = await seed_membership(user_id=BOB)
    await seed_page(workspace_id=alice_ws, title="Alice private")
    await seed_page(workspace_id=bob_ws, title="Bob private")

    alice_titles = [r.title for r in await as_app_role(ALICE, "SELECT title FROM pages")]
    assert alice_titles == ["Alice private"]

    bob_titles = [r.title for r in await as_app_role(BOB, "SELECT title FROM pages")]
    assert bob_titles == ["Bob private"]


@pytest.mark.asyncio
async def test_every_workspace_table_is_filtered():
    """Not just pages. A backstop with one table left out is not a backstop."""
    alice_ws = await seed_membership(user_id=ALICE)
    bob_ws = await seed_membership(user_id=BOB)
    for workspace in (alice_ws, bob_ws):
        await seed_page(workspace_id=workspace)
        collection = await seed_collection(workspace_id=workspace)
        await seed_item(workspace_id=workspace, collection_id=collection)

    for table in ("workspaces", "memberships", "pages", "collections", "items"):
        rows = await as_app_role(ALICE, f"SELECT * FROM {table}")
        assert len(rows) == 1, f"{table} leaked another tenant's rows to a non-member"


@pytest.mark.asyncio
async def test_an_unset_user_sees_nothing():
    """The default is deny. A connection that forgets to identify itself gets no data, rather
    than every tenant's data — which is how this kind of guard usually fails."""
    workspace = await seed_membership(user_id=ALICE)
    await seed_page(workspace_id=workspace)

    assert await as_app_role(None, "SELECT * FROM pages") == []
    assert await as_app_role("nobody-at-all", "SELECT * FROM pages") == []


@pytest.mark.asyncio
async def test_comments_are_read_by_the_workspace_and_written_by_the_author():
    """The split `AUTHOR_OWNED_TABLES` enforces on upload, expressed in the database."""
    workspace = await seed_membership(user_id=ALICE)
    await add_membership(user_id=BOB, workspace_id=workspace)
    page = await seed_page(workspace_id=workspace)
    await seed_comment(workspace_id=workspace, page_id=page, author_id=ALICE, body="by alice")

    # Bob is a member, so he reads it.
    assert len(await as_app_role(BOB, "SELECT * FROM comments")) == 1

    # But he cannot rewrite it: the UPDATE matches no row for him, and one for its author.
    changed = await as_app_role(BOB, "UPDATE comments SET body = 'hijacked' RETURNING id")
    assert changed == []
    changed = await as_app_role(ALICE, "UPDATE comments SET body = 'edited by author' RETURNING id")
    assert len(changed) == 1


@pytest.mark.asyncio
async def test_focus_sessions_are_private_to_their_owner():
    """Personal data is keyed by user, not workspace — a teammate must not reach it even
    though they share every workspace. This is the `user_private` bucket, in the database."""
    workspace = await seed_membership(user_id=ALICE)
    await add_membership(user_id=BOB, workspace_id=workspace)
    await seed_focus_session(user_id=ALICE, minutes=25)

    assert len(await as_app_role(ALICE, "SELECT * FROM focus_sessions")) == 1
    assert await as_app_role(BOB, "SELECT * FROM focus_sessions") == []


@pytest.mark.asyncio
async def test_a_member_cannot_write_into_another_workspace():
    """WITH CHECK, not just USING: reading is filtered, and so is smuggling a row in."""
    alice_ws = await seed_membership(user_id=ALICE)
    bob_ws = await seed_membership(user_id=BOB)

    async with TestSession() as session:
        await session.execute(
            text(f"SELECT set_config('{USER_SETTING}', :uid, true)"), {"uid": ALICE}
        )
        await session.execute(text(f'SET LOCAL ROLE "{APP_ROLE}"'))
        with pytest.raises(Exception) as caught:
            await session.execute(
                text(
                    "INSERT INTO pages (id, workspace_id, title, position, created_at, updated_at)"
                    " VALUES (:id, :ws, 'smuggled', 0, now(), now())"
                ),
                {"id": uuid4(), "ws": bob_ws},
            )
        assert "row-level security" in str(caught.value).lower()
        await session.rollback()

    # The same insert into her OWN workspace is allowed, so the policy is not simply blocking
    # everything — the usual way a test like this passes for the wrong reason.
    async with TestSession() as session:
        await session.execute(
            text(f"SELECT set_config('{USER_SETTING}', :uid, true)"), {"uid": ALICE}
        )
        await session.execute(text(f'SET LOCAL ROLE "{APP_ROLE}"'))
        await session.execute(
            text(
                "INSERT INTO pages (id, workspace_id, title, position, created_at, updated_at)"
                " VALUES (:id, :ws, 'mine', 0, now(), now())"
            ),
            {"id": uuid4(), "ws": alice_ws},
        )
        await session.rollback()
