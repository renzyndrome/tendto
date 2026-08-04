"""Workspace members + invitations — roles, guards, and the invite → accept flow."""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest_asyncio
from httpx import AsyncClient

from app.email.provider import SendResult, get_email_provider
from app.main import app
from app.models.core import Membership, WorkspaceInvitation
from app.tests.support import (
    TEST_USER_ID,
    TestSession,
    add_membership,
    count,
    delete_auth_users,
    seed_auth_user,
    seed_membership,
)

OTHER_USER_ID = "user_test_2"
ME = "me@tendto.test"
THEM = "them@tendto.test"


class RecordingEmail:
    """Captures sends instead of delivering, so tests assert on the message, not the network."""

    def __init__(self) -> None:
        self.sent: list[dict[str, str]] = []

    async def send(self, *, to: str, subject: str, text: str) -> SendResult:
        self.sent.append({"to": to, "subject": subject, "text": text})
        return SendResult(delivered=True)


@pytest_asyncio.fixture
async def mailbox() -> RecordingEmail:
    recorder = RecordingEmail()
    app.dependency_overrides[get_email_provider] = lambda: recorder
    yield recorder
    app.dependency_overrides.pop(get_email_provider, None)


@pytest_asyncio.fixture(autouse=True)
async def _auth_users() -> None:
    """Seed the two better-auth accounts these tests resolve emails for, then clean up —
    that table is outside Base.metadata so the truncate fixture doesn't touch it."""
    await seed_auth_user(user_id=TEST_USER_ID, email=ME, name="Me")
    await seed_auth_user(user_id=OTHER_USER_ID, email=THEM, name="Them")
    yield
    await delete_auth_users(TEST_USER_ID, OTHER_USER_ID)


# --- listing ------------------------------------------------------------------------------


async def test_list_members_returns_you_with_email_and_role(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="owner")

    body = (await client.get(f"/workspaces/{workspace_id}/members")).json()

    assert body["your_role"] == "owner"
    assert len(body["members"]) == 1
    assert body["members"][0]["email"] == ME
    assert body["members"][0]["is_you"] is True


async def test_non_member_gets_404_not_403(client: AsyncClient) -> None:
    """A non-member must not be able to probe which workspace ids exist."""
    foreign = await seed_membership(user_id=OTHER_USER_ID)

    res = await client.get(f"/workspaces/{foreign}/members")

    assert res.status_code == 404


async def test_pending_invites_are_hidden_from_non_owners(
    client: AsyncClient, mailbox: RecordingEmail
) -> None:
    workspace_id = await seed_membership(user_id=OTHER_USER_ID, role="owner")
    await add_membership(user_id=TEST_USER_ID, role="editor", workspace_id=workspace_id)

    body = (await client.get(f"/workspaces/{workspace_id}/members")).json()

    assert body["your_role"] == "editor"
    # Invitations are other people's email addresses — editors don't get them.
    assert body["invitations"] == []


# --- inviting -----------------------------------------------------------------------------


async def test_invite_creates_invitation_and_sends_email(
    client: AsyncClient, mailbox: RecordingEmail
) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="owner", name="Team")

    res = await client.post(
        f"/workspaces/{workspace_id}/invitations",
        json={"email": "New.Person@Example.com", "role": "editor"},
    )

    assert res.status_code == 201
    body = res.json()
    assert body["email_delivered"] is True
    # Stored lowercased so acceptance matches case-insensitively.
    assert body["invitation"]["email"] == "new.person@example.com"
    assert body["invite_url"].endswith(f"/invite/{body['invite_url'].rsplit('/', 1)[1]}")
    assert await count(WorkspaceInvitation) == 1
    assert len(mailbox.sent) == 1
    assert mailbox.sent[0]["to"] == "new.person@example.com"
    assert "Team" in mailbox.sent[0]["subject"]
    assert body["invite_url"] in mailbox.sent[0]["text"]


async def test_invite_is_owner_only(client: AsyncClient, mailbox: RecordingEmail) -> None:
    workspace_id = await seed_membership(user_id=OTHER_USER_ID, role="owner")
    await add_membership(user_id=TEST_USER_ID, role="editor", workspace_id=workspace_id)

    res = await client.post(
        f"/workspaces/{workspace_id}/invitations", json={"email": "x@y.test", "role": "editor"}
    )

    assert res.status_code == 403
    assert await count(WorkspaceInvitation) == 0


async def test_reinviting_refreshes_instead_of_duplicating(
    client: AsyncClient, mailbox: RecordingEmail
) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="owner")
    payload = {"email": "dup@example.com", "role": "editor"}

    first = (await client.post(f"/workspaces/{workspace_id}/invitations", json=payload)).json()
    second = (
        await client.post(
            f"/workspaces/{workspace_id}/invitations", json={**payload, "role": "viewer"}
        )
    ).json()

    assert await count(WorkspaceInvitation) == 1
    assert first["invite_url"] != second["invite_url"]  # token rotated
    assert second["invitation"]["role"] == "viewer"


async def test_cannot_invite_an_existing_member(
    client: AsyncClient, mailbox: RecordingEmail
) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="owner")
    await add_membership(user_id=OTHER_USER_ID, role="editor", workspace_id=workspace_id)

    res = await client.post(
        f"/workspaces/{workspace_id}/invitations", json={"email": THEM, "role": "editor"}
    )

    assert res.status_code == 409


async def test_invite_rejects_unknown_role(client: AsyncClient, mailbox: RecordingEmail) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="owner")

    res = await client.post(
        f"/workspaces/{workspace_id}/invitations", json={"email": "x@y.test", "role": "admin"}
    )

    assert res.status_code == 422


async def test_invite_without_email_provider_still_returns_a_usable_link(
    client: AsyncClient,
) -> None:
    """No mailbox fixture ⇒ the real factory returns ConsoleProvider (no key configured)."""
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="owner")

    body = (
        await client.post(
            f"/workspaces/{workspace_id}/invitations",
            json={"email": "nokey@example.com", "role": "editor"},
        )
    ).json()

    assert body["email_delivered"] is False
    assert "/invite/" in body["invite_url"]
    assert await count(WorkspaceInvitation) == 1


# --- accepting ----------------------------------------------------------------------------


async def _invite_token(client: AsyncClient, workspace_id, email: str, role: str = "editor") -> str:
    body = (
        await client.post(
            f"/workspaces/{workspace_id}/invitations", json={"email": email, "role": role}
        )
    ).json()
    return body["invite_url"].rsplit("/", 1)[1]


async def test_preview_is_available_without_membership(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="owner", name="Preview WS")
    token = await _invite_token(client, workspace_id, THEM)

    body = (await client.get(f"/invitations/{token}")).json()

    assert body["workspace_name"] == "Preview WS"
    assert body["email"] == THEM
    assert body["expired"] is False


async def _seed_invitation(
    *, workspace_id: UUID, email: str, token: str, role: str = "editor", ttl_days: float = 1
) -> str:
    """Insert an invitation directly. Used where the INVITER is not the authenticated test
    user, so it can't be created through the owner-only endpoint."""
    async with TestSession() as session:
        session.add(
            WorkspaceInvitation(
                id=uuid4(),
                workspace_id=workspace_id,
                email=email,
                role=role,
                token=token,
                invited_by=OTHER_USER_ID,
                expires_at=datetime.now(UTC) + timedelta(days=ttl_days),
            )
        )
        await session.commit()
    return token


async def test_accept_creates_membership_with_the_invited_role(client: AsyncClient) -> None:
    # OTHER_USER owns the workspace and invites ME (the authenticated test user).
    workspace_id = await seed_membership(user_id=OTHER_USER_ID, role="owner")
    token = await _seed_invitation(
        workspace_id=workspace_id, email=ME, token="tok_accept_ok", role="viewer"
    )

    res = await client.post(f"/invitations/{token}/accept")

    assert res.status_code == 200
    assert res.json()["workspace_id"] == str(workspace_id)
    assert await count(Membership) == 2
    assert await count(WorkspaceInvitation) == 0  # consumed


async def test_accept_refuses_when_signed_in_as_a_different_account(client: AsyncClient) -> None:
    """A leaked invite link must not grant access to whoever happens to hold it."""
    workspace_id = await seed_membership(user_id=OTHER_USER_ID, role="owner")
    token = await _seed_invitation(
        workspace_id=workspace_id,
        email="someone.else@example.com",  # NOT the signed-in user's address
        token="tok_wrong_account",
    )

    res = await client.post(f"/invitations/{token}/accept")

    assert res.status_code == 403
    assert await count(Membership) == 1  # unchanged
    assert await count(WorkspaceInvitation) == 1  # not consumed


async def test_accept_rejects_an_expired_invitation(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=OTHER_USER_ID, role="owner")
    token = await _seed_invitation(
        workspace_id=workspace_id, email=ME, token="tok_expired", ttl_days=-1
    )

    res = await client.post(f"/invitations/{token}/accept")

    assert res.status_code == 410
    assert await count(Membership) == 1


async def test_accept_with_unknown_token_is_404(client: AsyncClient) -> None:
    assert (await client.post("/invitations/nope/accept")).status_code == 404


# --- roles + removal ------------------------------------------------------------------------


async def test_owner_can_change_a_members_role(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="owner")
    await add_membership(user_id=OTHER_USER_ID, role="viewer", workspace_id=workspace_id)

    res = await client.patch(
        f"/workspaces/{workspace_id}/members/{OTHER_USER_ID}", json={"role": "editor"}
    )

    assert res.status_code == 200
    assert res.json()["role"] == "editor"


async def test_cannot_demote_the_last_owner(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="owner")

    res = await client.patch(
        f"/workspaces/{workspace_id}/members/{TEST_USER_ID}", json={"role": "viewer"}
    )

    assert res.status_code == 409


async def test_owner_can_remove_a_member(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="owner")
    await add_membership(user_id=OTHER_USER_ID, role="editor", workspace_id=workspace_id)

    res = await client.delete(f"/workspaces/{workspace_id}/members/{OTHER_USER_ID}")

    assert res.status_code == 204
    assert await count(Membership) == 1


async def test_editor_cannot_remove_someone_else(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=OTHER_USER_ID, role="owner")
    await add_membership(user_id=TEST_USER_ID, role="editor", workspace_id=workspace_id)

    res = await client.delete(f"/workspaces/{workspace_id}/members/{OTHER_USER_ID}")

    assert res.status_code == 403
    assert await count(Membership) == 2


async def test_a_member_can_leave_on_their_own(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=OTHER_USER_ID, role="owner")
    await add_membership(user_id=TEST_USER_ID, role="editor", workspace_id=workspace_id)

    res = await client.delete(f"/workspaces/{workspace_id}/members/{TEST_USER_ID}")

    assert res.status_code == 204
    assert await count(Membership) == 1


async def test_cannot_remove_the_last_owner(client: AsyncClient) -> None:
    workspace_id = await seed_membership(user_id=TEST_USER_ID, role="owner")

    res = await client.delete(f"/workspaces/{workspace_id}/members/{TEST_USER_ID}")

    assert res.status_code == 409
