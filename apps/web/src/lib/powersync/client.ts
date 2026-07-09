/**
 * PowerSync client setup: local SQLite database + the connector that
 * (a) supplies the Clerk JWT for the sync stream, and
 * (b) uploads queued writes to FastAPI — the authoritative write path.
 */
import {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  PowerSyncDatabase,
} from "@powersync/web";

import { apiFetch } from "../api/client";
import { AppSchema } from "./schema";

export const db = new PowerSyncDatabase({
  schema: AppSchema,
  database: { dbFilename: "tendto.db" },
});

class Connector implements PowerSyncBackendConnector {
  async fetchCredentials() {
    // TODO(phase-0): get a Clerk JWT (template with audience "powersync")
    // const token = await window.Clerk?.session?.getToken({ template: "powersync" });
    const token = "";
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
