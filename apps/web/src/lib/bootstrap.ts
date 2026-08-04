/**
 * Bootstrap: provision the signed-in user's personal workspace server-side, then decide which
 * workspace to make active. The provisioned rows sync down into the local replica afterwards.
 *
 * This is also where the app learns which workspaces are ACTUALLY the user's. That list is the
 * authority — the replica is not. A local SQLite file can hold workspace rows the server no
 * longer agrees with (a workspace deleted while this device was offline, rows left by another
 * account, or a dev database reset), and nothing ever tells a client to drop them: removals
 * only arrive as bucket updates, which a disconnected client never receives. Trusting the
 * replica alone showed phantom duplicates in the switcher and, worse, could make a workspace
 * active that the user isn't a member of — every API call for it then 404s.
 *
 * Offline / API-down still degrades gracefully: with no authoritative list we fall back to the
 * replica, so the app opens instantly and read-only work continues.
 */
import { apiFetch } from "./api/client";
import { db } from "./powersync/client";
import { readStoredWorkspaceId } from "./workspaces";

export interface BootstrapWorkspace {
  id: string;
  name: string;
  role: string;
}

interface BootstrapResponse {
  workspaces: BootstrapWorkspace[];
}

export interface BootstrapResult {
  /** The workspace to open, or null when the user has none yet. */
  activeId: string | null;
  /**
   * Every workspace id the server says the user belongs to, or null when the API was
   * unreachable (meaning "unknown" — callers must not treat that as "none").
   */
  knownIds: string[] | null;
}

export async function bootstrapWorkspaces(): Promise<BootstrapResult> {
  const preferred = readStoredWorkspaceId();

  try {
    const res = await apiFetch("/bootstrap", { method: "POST" });
    const body = (await res.json()) as BootstrapResponse;
    const knownIds = body.workspaces.map((workspace) => workspace.id);
    // Reopen what this device had last — but only if the user is still a member of it.
    const activeId =
      preferred && knownIds.includes(preferred) ? preferred : (knownIds[0] ?? null);
    return { activeId, knownIds };
  } catch {
    // API unreachable — fall through to the local replica.
  }

  if (preferred) {
    const stored = await db.getAll<{ id: string }>("SELECT id FROM workspaces WHERE id = ?", [
      preferred,
    ]);
    if (stored.length > 0) return { activeId: preferred, knownIds: null };
  }

  const rows = await db.getAll<{ id: string }>(
    "SELECT id FROM workspaces ORDER BY created_at LIMIT 1",
  );
  return { activeId: rows[0]?.id ?? null, knownIds: null };
}
