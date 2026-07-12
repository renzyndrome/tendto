"""POST /bootstrap — idempotent first-run provisioning."""

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
