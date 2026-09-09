/**
 * Browser implementation of the PowerSync platform seam (see platform-contract.ts).
 *
 * SQLite runs as wasm in a worker and persists to OPFS; the backend connector is right here in
 * JavaScript. This is the build that ships to phones as the PWA.
 */
import type {
  CommonPowerSyncDatabase,
  PowerSyncBackendConnector,
} from "@powersync/common";
import { PowerSyncDatabase } from "@powersync/web";

import { apiFetch } from "../api/client";
import { getAuthToken } from "../auth/token";
import type { PowerSyncPlatform } from "./platform-contract";
import { AppSchema } from "./schema";

const db = new PowerSyncDatabase({
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
  async uploadData(database: CommonPowerSyncDatabase) {
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
 * what stops the nudges from reviving a signed-out session.
 */
let connector: Connector | null = null;
let reconnecting = false;

export const platform: PowerSyncPlatform = {
  db,

  async connect() {
    connector = new Connector();
    await db.connect(connector);
  },

  /**
   * Re-open the sync stream if it is closed.
   *
   * PowerSync retries on its own, but with a backoff that grows while a laptop is shut: come
   * back the next morning and the app can sit disconnected for the remainder of a long delay,
   * looking like a bug ("my phone's edits aren't here"). The caller fires this on events that say
   * "the world just changed" far more precisely than any timer.
   *
   * `db.connected` is not trustworthy as a reason to do nothing — a socket dropped by a sleeping
   * network can still report as connected until something writes to it — so a caller that knows
   * the network genuinely changed gets a re-dial regardless (see `ensureConnected` in client.ts).
   */
  async reconnect() {
    if (!connector || reconnecting) return;
    reconnecting = true;
    try {
      await db.connect(connector);
    } finally {
      reconnecting = false;
    }
  },

  async signOut() {
    // Drop the connector first: it is what `reconnect` checks, so a stray "online" event during
    // teardown must not re-open the stream for the account that is signing out.
    connector = null;
  },

  async restoreSession() {
    // The browser session is an HttpOnly cookie; there is nothing for the app to restore.
  },
};
