"""POST /workspaces — creating an additional workspace + its owner membership."""

from uuid import UUID, uuid4

from httpx import AsyncClient
from sqlalchemy import select

from app.models.core import Membership, Workspace
from app.tests.support import TEST_USER_ID, TestSession, count, fetch, seed_membership


async def _owner_of(workspace_id: str | UUID) -> str | None:
    async with TestSession() as session:
        return await session.scalar(
            select(Membership.user_id).where(Membership.workspace_id == workspace_id)
        )


async def test_create_workspace_creates_owner_membership(client: AsyncClient) -> None:
    res = await client.post("/workspaces", json={"name": "Side Project"})

    assert res.status_code == 201
    body = res.json()
    assert body["name"] == "Side Project"
    assert body["role"] == "owner"
    assert await count(Workspace) == 1
    assert await count(Membership) == 1
    # The membership must belong to the authenticated caller.
    assert await _owner_of(body["id"]) == TEST_USER_ID


async def test_create_workspace_accepts_client_generated_id(client: AsyncClient) -> None:
    workspace_id = str(uuid4())

    res = await client.post("/workspaces", json={"id": workspace_id, "name": "Client Id"})

    assert res.status_code == 201
    assert res.json()["id"] == workspace_id


async def test_create_workspace_is_idempotent_on_replay(client: AsyncClient) -> None:
    workspace_id = str(uuid4())
    payload = {"id": workspace_id, "name": "Replayed"}

    first = await client.post("/workspaces", json=payload)
    second = await client.post("/workspaces", json=payload)

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    # The replay must not provision a second workspace or a duplicate membership.
    assert await count(Workspace) == 1
    assert await count(Membership) == 1


async def test_create_workspace_cannot_claim_another_users_workspace(client: AsyncClient) -> None:
    foreign_id = await seed_membership(user_id="someone_else", name="Theirs")

    res = await client.post("/workspaces", json={"id": str(foreign_id), "name": "Mine Now"})

    assert res.status_code == 409
    # No membership was granted to the caller and the name was not overwritten.
    assert await count(Membership) == 1
    assert await _owner_of(foreign_id) == "someone_else"
    workspace = await fetch(Workspace, foreign_id)
    assert workspace.name == "Theirs"


async def test_create_workspace_falls_back_to_default_name(client: AsyncClient) -> None:
    res = await client.post("/workspaces", json={"name": "   "})

    assert res.status_code == 201
    assert res.json()["name"] == "New Workspace"


async def test_bootstrap_lists_workspaces_created_afterwards(client: AsyncClient) -> None:
    await client.post("/bootstrap")
    await client.post("/workspaces", json={"name": "Second"})

    listed = (await client.post("/bootstrap")).json()["workspaces"]

    assert len(listed) == 2
    assert {w["name"] for w in listed} == {"My Workspace", "Second"}
    assert all(w["role"] == "owner" for w in listed)
