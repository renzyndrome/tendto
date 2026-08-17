/**
 * Workspace creation — the one content-shaped mutation that is NOT a local write.
 *
 * A workspace can't be created in the replica and synced up: the upload path requires the
 * writer to already be a member of the target workspace, so a client-side INSERT would be
 * rejected with 403 (see apps/api/app/routers/sync.py). The workspace and the caller's owner
 * membership have to be created together, server-side — that's POST /workspaces.
 *
 * The id is still client-generated (CLAUDE.md invariant 3), so a retry is idempotent.
 * Requires connectivity by nature; callers surface the failure rather than queueing it.
 */
import { apiFetch } from "./api/client";
import { db } from "./powersync/client";

/** How long to wait for the new workspace to sync down before switching to it anyway. */
const SYNC_WAIT_MS = 5000;
const SYNC_POLL_MS = 100;

/** Which workspace this device last had open. Per-device UI state, never synced. */
const ACTIVE_WORKSPACE_KEY = "tendto:workspace";

export function readStoredWorkspaceId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  } catch {
    return null;
  }
}

export function storeActiveWorkspaceId(workspaceId: string | null): void {
  try {
    if (workspaceId) localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspaceId);
    else localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
  } catch {
    // Storage unavailable — the choice just won't survive a reload.
  }
}

export interface CreatedWorkspace {
  id: string;
  name: string;
  role: string;
}

async function existsLocally(workspaceId: string): Promise<boolean> {
  const rows = await db.getAll<{ id: string }>("SELECT id FROM workspaces WHERE id = ?", [
    workspaceId,
  ]);
  return rows.length > 0;
}

/**
 * Wait until the row has replicated into the local replica. The sidebar reads workspace names
 * from the replica, so switching before the row lands would flash an empty name. Best-effort:
 * resolves anyway on timeout, since the row will still appear reactively.
 */
async function waitForLocalRow(workspaceId: string): Promise<void> {
  const deadline = Date.now() + SYNC_WAIT_MS;
  while (Date.now() < deadline) {
    if (await existsLocally(workspaceId)) return;
    await new Promise((resolve) => setTimeout(resolve, SYNC_POLL_MS));
  }
}

/**
 * Rename a workspace. Unlike creation, this IS a plain local write: the row already exists and
 * the caller is already a member, so the upload path authorises it like any other edit — which
 * keeps renaming instant and available offline.
 */
export async function renameWorkspace(workspaceId: string, name: string): Promise<void> {
  await db.execute("UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?", [
    name,
    new Date().toISOString(),
    workspaceId,
  ]);
}

/** Create a workspace and return it once it has (best-effort) synced into the replica. */
export async function createWorkspace(name: string): Promise<CreatedWorkspace> {
  const id = crypto.randomUUID();
  const res = await apiFetch("/workspaces", {
    method: "POST",
    body: JSON.stringify({ id, name: name.trim() || "New Workspace" }),
  });
  const created = (await res.json()) as CreatedWorkspace;
  await waitForLocalRow(created.id);
  return created;
}
