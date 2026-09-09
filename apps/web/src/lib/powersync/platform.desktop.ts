/**
 * Desktop (Tauri) implementation of the PowerSync platform seam (see platform-contract.ts).
 *
 * The replica is a real SQLite file owned by Rust, not the webview's OPFS — that durability is
 * the reason the desktop shell exists at all. Two consequences shape this file:
 *
 *   1. **JavaScript cannot open the sync stream.** The alpha SDK throws from `db.connect()`; the
 *      backend connector is implemented in Rust (apps/desktop/src-tauri/src/connector.rs) and JS
 *      only hands over the database handle and the service URLs.
 *   2. **The session token lives in Rust too** (session.rs), because webview storage is exactly
 *      what Tauri does not reliably preserve across app updates.
 *
 * The URLs are passed from here rather than compiled into the Rust binary so that the JS bundle
 * stays the single source of truth for which backend a build talks to.
 */
import { invoke } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import { PowerSyncTauriDatabase } from "@powersync/tauri-plugin";

import { setSessionToken } from "../auth/session-token";
import type { PowerSyncPlatform } from "./platform-contract";
import { AppSchema } from "./schema";

const db = new PowerSyncTauriDatabase({
  schema: AppSchema,
  database: {
    dbFilename: "tendto.db",
    // A function, not a resolved path: the SDK joins it with dbFilename when it initialises.
    dbLocationAsync: appDataDir,
  },
});

/** Service URLs, baked into this bundle at build time (see .env.desktop). */
const urls = {
  authUrl: import.meta.env.VITE_AUTH_URL as string,
  apiUrl: import.meta.env.VITE_API_URL as string,
  powersyncUrl: import.meta.env.VITE_POWERSYNC_URL as string,
};

/** Whether Rust has been asked to connect, so `reconnect` knows there is a stream to re-dial. */
let connected = false;

export const platform: PowerSyncPlatform = {
  db,

  async connect() {
    // `init` opens the file and applies the schema; `rustHandle` is only valid afterwards.
    await db.init();
    await invoke("connect", { handle: db.rustHandle, urls });
    connected = true;
  },

  async reconnect() {
    if (!connected) return;
    await invoke("reconnect", { handle: db.rustHandle });
  },

  async signOut() {
    connected = false;
    await invoke("session_clear");
  },

  async restoreSession() {
    // Rust kept the session token across the restart; hand it back to the auth client before it
    // makes its first request, or every launch would look like a sign-out.
    const token = await invoke<string | null>("session_get");
    if (token) setSessionToken(token);
  },
};
