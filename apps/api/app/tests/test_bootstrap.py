"""POST /bootstrap — idempotent first-run provisioning."""

import asyncio

from httpx import AsyncClient

from app.models.core import Membership, Workspace
from app.tests.support import count


async def test_bootstrap_creates_personal_workspace(client: AsyncClient) -> None:
    res = await client.post("/bootstrap")

    assert res.status_code == 200
    workspaces = res.json()["workspaces"]
    assert len(workspaces) == 1
    assert workspaces[0]["name"] == "My Workspace"
    assert workspaces[0]["role"] == "owner"
    assert await count(Workspace) == 1
    assert await count(Membership) == 1


async def test_bootstrap_is_idempotent(client: AsyncClient) -> None:
    first = (await client.post("/bootstrap")).json()
    second = (await client.post("/bootstrap")).json()

    assert len(first["workspaces"]) == 1
    assert len(second["workspaces"]) == 1
    # Same workspace returned; no second workspace was provisioned.
    assert first["workspaces"][0]["id"] == second["workspaces"][0]["id"]
    assert await count(Workspace) == 1
    assert await count(Membership) == 1


async def test_concurrent_bootstrap_provisions_exactly_one_workspace(
    client: AsyncClient,
) -> None:
    """The client calls /bootstrap on boot and React StrictMode fires that effect twice, so two
    requests land in parallel. Without the per-user advisory lock both read "no membership"
    before either commits and the user ends up with two identical "My Workspace" entries."""
    responses = await asyncio.gather(*(client.post("/bootstrap") for _ in range(5)))

    assert [res.status_code for res in responses] == [200] * 5
    assert await count(Workspace) == 1
    assert await count(Membership) == 1
    # Every concurrent caller must observe the same single workspace.
    ids = {res.json()["workspaces"][0]["id"] for res in responses}
    assert len(ids) == 1
