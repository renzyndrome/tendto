/**
 * PowerSync client: the local SQLite replica, and the lifecycle around it.
 *
 * Everything platform-specific — how the replica is opened, and who talks to the sync service —
 * lives behind `@powersync-platform` (see platform-contract.ts). In the browser that is wasm
 * SQLite plus a JavaScript connector; in the desktop shell it is a Rust-owned SQLite file with a
 * Rust connector. What stays here is what is true on both: the search index has to be built
 * before the stream opens, a sleeping device needs nudging back onto the network, and signing out
 * must wipe this device's copy of the data.
 *
 * The one invariant neither platform may break: **every write goes up through FastAPI**
 * (`POST /sync/upload`), never straight to Postgres.
 */
import { platform } from "@powersync-platform";

import { setupFts, teardownFts } from "./fts";

/** The local replica. All content reads in the app go through this. */
export const db = platform.db;

let reconnecting = false;
let nudgesInstalled = false;

/**
 * Ask for a reconnect if the stream may have dropped.
 *
 * PowerSync retries on its own, but with a backoff that grows while a laptop is shut: come back
 * the next morning and the app can sit disconnected for the remainder of a long delay, looking
 * like a bug ("my phone's edits aren't here"). The events below say "the world just changed" far
 * more precisely than any timer, so we ask for an attempt right then.
 *
 * `force` exists because `db.connected` is not trustworthy as a reason to do nothing: a socket
 * dropped by a sleeping network can still be reported as connected until something writes to it.
 * So a genuine `online` transition always re-dials, while the far more frequent tab-focus check
 * defers to the flag and usually costs nothing.
 */
async function ensureConnected(force = false): Promise<void> {
  if (reconnecting) return;
  if (!force && db.connected) return;
  reconnecting = true;
  try {
    await platform.reconnect();
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

/**
 * Restore a session that was persisted outside the webview. No-op in the browser; on the desktop
 * it hands the stored token back before better-auth's first request, so a restart does not look
 * like a sign-out.
 */
export async function restoreSession(): Promise<void> {
  await platform.restoreSession();
}

export async function connectDb(): Promise<void> {
  // Build the search index before opening the stream, so the triggers are in place for the
  // rows the first sync applies. Non-fatal: search falls back to LIKE scans if it fails.
  await setupFts(db);
  installReconnectNudges();
  await platform.connect();
}

/**
 * Sign-out teardown. MUST clear the replica, not just disconnect: the local SQLite file is
 * this device's copy of one user's workspaces, so leaving it in place would (a) expose the
 * previous account's content to whoever signs in next on a shared device, and (b) leave rows
 * that no longer exist server-side sitting in the replica forever — they are only ever
 * removed by a bucket update, which a signed-out client never receives.
 */
export async function disconnectAndClearDb(): Promise<void> {
  // Drop the platform's connection state first: it is what the reconnect nudges check, so a
  // stray "online" event during teardown must not re-open the stream for the account that is
  // signing out. On the desktop this also deletes the stored session token.
  try {
    await platform.signOut();
  } catch (err) {
    console.error("Failed to clear this device's session on sign out", err);
  }
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
