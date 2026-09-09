/**
 * PowerSync client setup: local SQLite database + the connector that
 * (a) supplies the better-auth JWT for the sync stream, and
 * (b) uploads queued writes to FastAPI — the authoritative write path.
 */
import {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  PowerSyncDatabase,
} from "@powersync/web";

import { apiFetch } from "../api/client";
import { getAuthToken } from "../auth/token";
import { setupFts, teardownFts } from "./fts";
import { AppSchema } from "./schema";

export const db = new PowerSyncDatabase({
  schema: AppSchema,
  database: { dbFilename: "tendto.db" },
});

class Connector implements PowerSyncBackendConnector {
  async fetchCredentials() {
    // The same better-auth JWT that authenticates FastAPI also authenticates the sync stream.
    // PowerSync re-calls this before the token expires and verifies it against the auth
    // service's JWKS (see infra/powersync/config.yaml).
    const token = await getAuthToken();
    // No valid session yet (or offline with no cached token): return null so PowerSync waits
    // and retries rather than opening the stream with an empty token.
    if (!token) return null;
    return {
      endpoint: import.meta.env.VITE_POWERSYNC_URL as string,
      token,
    };
  }

  /** Upload queued local writes to FastAPI. Never bypasses the API. */
  async uploadData(database: AbstractPowerSyncDatabase) {
    const tx = await database.getNextCrudTransaction();
    if (!tx) return;
    try {
      await apiFetch("/sync/upload", {
        method: "POST",
        body: JSON.stringify({
          entries: tx.crud.map((op) => ({
            op: op.op.toUpperCase(),
            table: op.table,
            id: op.id,
            data: op.opData ?? null,
          })),
        }),
      });
      await tx.complete();
    } catch (err) {
      // Leave the transaction in the queue; PowerSync retries with backoff.
      console.error("uploadData failed; will retry", err);
      throw err;
    }
  }
}

/**
 * The live connector, kept so a reconnect can reuse it. Null while signed out — which is also
 * what stops the nudges below from reviving a signed-out session.
 */
let connector: Connector | null = null;
let reconnecting = false;
let nudgesInstalled = false;

/**
 * Re-open the sync stream if it is closed.
 *
 * PowerSync retries on its own, but with a backoff that grows while a laptop is shut: come
 * back the next morning and the app can sit disconnected for the remainder of a long delay,
 * looking like a bug ("my phone's edits aren't here"). The events below say "the world just
 * changed" far more precisely than any timer, so we ask for an attempt right then.
 *
 * `force` exists because `db.connected` is not trustworthy as a reason to do nothing: a socket
 * dropped by a sleeping network can still be reported as connected until something writes to
 * it. So a genuine `online` transition always re-dials, while the far more frequent
 * tab-focus check defers to the flag and usually costs nothing.
 */
async function ensureConnected(force = false): Promise<void> {
  if (!connector || reconnecting) return;
  if (!force && db.connected) return;
  reconnecting = true;
  try {
    await db.connect(connector);
  } catch (err) {
    // Still offline, or the auth service is down. PowerSync keeps its own retry going.
    console.error("Reconnect attempt failed; PowerSync will keep retrying", err);
  } finally {
    reconnecting = false;
  }
}

function installReconnectNudges(): void {
  if (nudgesInstalled) return;
  nudgesInstalled = true;
  // Coming back onto a network, and coming back to the tab — a phone wakes with the tab
  // already "online", so visibility is the one that catches a backgrounded PWA.
  window.addEventListener("online", () => void ensureConnected(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void ensureConnected();
  });
}

export async function connectDb(): Promise<void> {
  // Build the search index before opening the stream, so the triggers are in place for the
  // rows the first sync applies. Non-fatal: search falls back to LIKE scans if it fails.
  await setupFts(db);
  connector = new Connector();
  installReconnectNudges();
  await db.connect(connector);
}

/**
 * Sign-out teardown. MUST clear the replica, not just disconnect: the local SQLite file is
 * this device's copy of one user's workspaces, so leaving it in place would (a) expose the
 * previous account's content to whoever signs in next on a shared device, and (b) leave rows
 * that no longer exist server-side sitting in the replica forever — they are only ever
 * removed by a bucket update, which a signed-out client never receives.
 */
export async function disconnectAndClearDb(): Promise<void> {
  // Drop the connector first: it is what the reconnect nudges check, so a stray "online" event
  // during teardown must not re-open the stream for the account that is signing out.
  connector = null;
  // The search index is a copy of this account's titles and block text — clear it too, and
  // before the replica, so its triggers are gone before the rows they watch are removed.
  await teardownFts(db);
  try {
    await db.disconnectAndClear();
  } catch (err) {
    // Never block sign-out on teardown; the session is already gone.
    console.error("Failed to clear the local replica on sign out", err);
  }
}
