/**
 * Bootstrap: provision the signed-in user's personal workspace server-side, then decide which
 * workspace to make active. The provisioned rows sync down into the local replica afterwards.
 *
 * Offline / API-down degrades gracefully: we fall back to whatever workspace already synced
 * locally, so the app still opens instantly from the replica.
 */
import { apiFetch } from "./api/client";
import { db } from "./powersync/client";

export interface BootstrapWorkspace {
  id: string;
  name: string;
  role: string;
}

interface BootstrapResponse {
  workspaces: BootstrapWorkspace[];
}

/** Returns the id of the workspace to make active, or null if none is available yet. */
export async function bootstrapWorkspaces(): Promise<string | null> {
  try {
    const res = await apiFetch("/bootstrap", { method: "POST" });
    const body = (await res.json()) as BootstrapResponse;
    const first = body.workspaces[0];
    if (first) return first.id;
  } catch {
    // API unreachable — fall through to the local replica.
  }

  const rows = await db.getAll<{ id: string }>(
    "SELECT id FROM workspaces ORDER BY created_at LIMIT 1",
  );
  return rows[0]?.id ?? null;
}
