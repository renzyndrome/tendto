"""DELETE /workspaces/{id} — owner-only, cascading, with the last-workspace guard."""

from httpx import AsyncClient

from app.models.core import Collection, Membership, Page, Workspace, WorkspaceInvitation
from app.tests.support import (
    TEST_USER_ID,
    add_membership,
    count,
    seed_membership,
    seed_page,
)

OTHER_USER_ID = "user_test_2"


async def test_owner_can_delete_a_workspace_and_its_contents(client: AsyncClient) -> None:
    keep = await seed_membership(user_id=TEST_USER_ID, role="owner", name="Keep")
    doomed = await seed_membership(user_id=TEST_USER_ID, role="owner", name="Doomed")
    await seed_page(workspace_id=doomed)

    res = await client.delete(f"/workspaces/{doomed}")

    assert res.status_code == 204
    assert await count(Workspace) == 1
    # Pages cascade from the workspace FK, and so does the membership.
    assert await count(Page) == 0
    assert await count(Membership) == 1
    assert (await client.post("/bootstrap")).json()["workspaces"][0]["id"] == str(keep)


async def test_cannot_delete_your_only_workspace(client: AsyncClient) -> None:
    only = await seed_membership(user_id=TEST_USER_ID, role="owner")

    res = await client.delete(f"/workspaces/{only}")

    assert res.status_code == 409
    assert await count(Workspace) == 1


async def test_editor_cannot_delete_a_workspace(client: AsyncClient) -> None:
    await seed_membership(user_id=TEST_USER_ID, role="owner", name="Mine")
    shared = await seed_membership(user_id=OTHER_USER_ID, role="owner", name="Theirs")
    await add_membership(user_id=TEST_USER_ID, role="editor", workspace_id=shared)

    res = await client.delete(f"/workspaces/{shared}")

    assert res.status_code == 403
    assert await count(Workspace) == 2


async def test_non_member_gets_404(client: AsyncClient) -> None:
    await seed_membership(user_id=TEST_USER_ID, role="owner")
    foreign = await seed_membership(user_id=OTHER_USER_ID, role="owner")

    res = await client.delete(f"/workspaces/{foreign}")

    assert res.status_code == 404
    assert await count(Workspace) == 2


async def test_delete_takes_pending_invitations_with_it(client: AsyncClient) -> None:
    await seed_membership(user_id=TEST_USER_ID, role="owner", name="Keep")
    doomed = await seed_membership(user_id=TEST_USER_ID, role="owner", name="Doomed")
    await client.post(f"/workspaces/{doomed}/invitations", json={"email": "pending@example.com"})
    assert await count(WorkspaceInvitation) == 1

    await client.delete(f"/workspaces/{doomed}")

    # An invite link must not outlive the workspace it points at.
    assert await count(WorkspaceInvitation) == 0
    assert await count(Collection) == 0
