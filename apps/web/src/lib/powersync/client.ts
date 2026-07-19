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

import { ApiError, apiFetch } from "../api/client";
import { getAuthToken } from "../auth/token";
import { AppSchema } from "./schema";

// A 4xx from the write path is PERMANENT — retrying can never succeed (bad table, no access,
// gone). Such an op must be discarded so it doesn't wedge the whole upload queue (and, with it,
// downloads). 401 is excluded: it's a transient token issue that a refresh + retry fixes.
function isPermanentRejection(err: unknown): boolean {
  return (
    err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401
  );
}

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
      if (isPermanentRejection(err)) {
        // The server refused this write for good (e.g. a stale op for a workspace this user is no
        // longer a member of). Drop it so the queue can drain instead of looping forever.
        console.warn("uploadData: discarding a permanently-rejected write", err, tx.crud);
        await tx.complete();
        return;
      }
      // Transient (network / 5xx / 401): leave it queued; PowerSync retries with backoff.
      console.error("uploadData failed; will retry", err);
      throw err;
    }
  }
}

export async function connectDb(): Promise<void> {
  await db.connect(new Connector());
}
