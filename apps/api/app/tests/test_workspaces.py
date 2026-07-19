"""Shared-workspace collaboration — invites, accept, members, roles."""

from uuid import uuid4

from httpx import AsyncClient

from app.auth import CurrentUser, get_current_user
from app.main import app
from app.models.core import Membership
from app.tests.support import TEST_USER_ID, count, seed_membership

INVITEE_ID = "user_test_2"


def _act_as(user_id: str) -> None:
    """Swap the request's authenticated user (the client fixture pins TEST_USER_ID)."""
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(id=user_id)


async def test_create_workspace_makes_caller_owner(client: AsyncClient) -> None:
    res = await client.post("/workspaces", json={"name": "Side Project"})
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == "Side Project"
    assert body["role"] == "owner"

    # The caller can immediately mint an invite for it (proving the owner membership landed).
    invite = await client.post(
        "/workspaces/invites", json={"workspace_id": body["id"], "role": "editor"}
    )
    assert invite.status_code == 200
    assert await count(Membership) == 1


async def test_create_workspace_defaults_blank_name(client: AsyncClient) -> None:
    res = await client.post("/workspaces", json={"name": "   "})
    assert res.status_code == 200
    assert res.json()["name"] == "Untitled"


async def test_owner_creates_invite_and_second_user_accepts(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="owner")

    created = await client.post(
        "/workspaces/invites",
        json={"workspace_id": str(workspace_id), "role": "editor"},
    )
    assert created.status_code == 200
    token = created.json()["token"]
    assert created.json()["role"] == "editor"

    # A different user previews then accepts.
    _act_as(INVITEE_ID)
    preview = await client.get(f"/workspaces/invites/{token}")
    assert preview.status_code == 200
    assert preview.json()["valid"] is True
    assert preview.json()["role"] == "editor"

    accept = await client.post(f"/workspaces/invites/{token}/accept")
    assert accept.status_code == 200
    assert accept.json()["already_member"] is False
    assert accept.json()["role"] == "editor"

    # Membership now exists for the invitee.
    assert await count(Membership) == 2


async def test_invite_is_single_use(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="owner")
    token = (
        await client.post(
            "/workspaces/invites", json={"workspace_id": str(workspace_id), "role": "viewer"}
        )
    ).json()["token"]

    _act_as(INVITEE_ID)
    assert (await client.post(f"/workspaces/invites/{token}/accept")).status_code == 200

    # A third user can't reuse the spent link.
    _act_as("user_test_3")
    reused = await client.post(f"/workspaces/invites/{token}/accept")
    assert reused.status_code == 410


async def test_accept_is_idempotent_for_existing_member(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="owner")
    token = (
        await client.post(
            "/workspaces/invites", json={"workspace_id": str(workspace_id), "role": "editor"}
        )
    ).json()["token"]

    # The owner accepting their own workspace's link is a no-op (keeps their owner role).
    accept = await client.post(f"/workspaces/invites/{token}/accept")
    assert accept.status_code == 200
    assert accept.json()["already_member"] is True
    assert accept.json()["role"] == "owner"
    assert await count(Membership) == 1


async def test_non_owner_cannot_create_invite(client: AsyncClient) -> None:
    # TEST_USER_ID is only an editor here → 403.
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="editor")
    res = await client.post(
        "/workspaces/invites", json={"workspace_id": str(workspace_id), "role": "editor"}
    )
    assert res.status_code == 403
    assert await count(Membership) == 1


async def test_invite_rejects_owner_role(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="owner")
    res = await client.post(
        "/workspaces/invites", json={"workspace_id": str(workspace_id), "role": "owner"}
    )
    assert res.status_code == 400


async def test_list_members_shows_members_and_pending_invites(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="owner")
    await client.post(
        "/workspaces/invites", json={"workspace_id": str(workspace_id), "role": "editor"}
    )

    res = await client.get(f"/workspaces/{workspace_id}/members")
    assert res.status_code == 200
    body = res.json()
    assert len(body["members"]) == 1
    assert body["members"][0]["role"] == "owner"
    assert len(body["invites"]) == 1


async def test_owner_removes_member(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="owner")
    token = (
        await client.post(
            "/workspaces/invites", json={"workspace_id": str(workspace_id), "role": "editor"}
        )
    ).json()["token"]
    _act_as(INVITEE_ID)
    await client.post(f"/workspaces/invites/{token}/accept")
    assert await count(Membership) == 2

    _act_as(TEST_USER_ID)
    removed = await client.delete(f"/workspaces/{workspace_id}/members/{INVITEE_ID}")
    assert removed.status_code == 204
    assert await count(Membership) == 1


async def test_cannot_remove_only_owner(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="owner")
    res = await client.delete(f"/workspaces/{workspace_id}/members/{TEST_USER_ID}")
    assert res.status_code == 409
    assert await count(Membership) == 1


async def test_preview_unknown_token_is_invalid(client: AsyncClient) -> None:
    res = await client.get("/workspaces/invites/does-not-exist")
    assert res.status_code == 200
    assert res.json()["valid"] is False
    assert res.json()["reason"] == "not_found"


async def test_sync_upload_rejects_membership_writes(client: AsyncClient) -> None:
    """Defense in depth: an editor cannot forge a membership row through the generic upload
    path — memberships are server-authoritative (created only by bootstrap/accept-invite)."""
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="editor")
    res = await client.post(
        "/sync/upload",
        json={
            "entries": [
                {
                    "op": "PUT",
                    "table": "memberships",
                    "id": str(uuid4()),
                    "data": {
                        "user_id": TEST_USER_ID,
                        "workspace_id": str(workspace_id),
                        "role": "owner",  # the escalation attempt
                        "updated_at": "2026-07-14T00:00:00+00:00",
                    },
                }
            ]
        },
    )
    assert res.status_code == 400  # "Unknown table: memberships" — write refused
    assert await count(Membership) == 1  # still just the editor row
