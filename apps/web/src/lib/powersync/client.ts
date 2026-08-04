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

export async function connectDb(): Promise<void> {
  await db.connect(new Connector());
}

/**
 * Sign-out teardown. MUST clear the replica, not just disconnect: the local SQLite file is
 * this device's copy of one user's workspaces, so leaving it in place would (a) expose the
 * previous account's content to whoever signs in next on a shared device, and (b) leave rows
 * that no longer exist server-side sitting in the replica forever — they are only ever
 * removed by a bucket update, which a signed-out client never receives.
 */
export async function disconnectAndClearDb(): Promise<void> {
  try {
    await db.disconnectAndClear();
  } catch (err) {
    // Never block sign-out on teardown; the session is already gone.
    console.error("Failed to clear the local replica on sign out", err);
  }
}
