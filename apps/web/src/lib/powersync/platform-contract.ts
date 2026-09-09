/**
 * The one seam between the browser app and the desktop shell.
 *
 * Both builds run the same React code and read from the same local SQLite replica, but *how* the
 * replica is opened and driven differs completely:
 *
 *   - **Browser**: `@powersync/web` runs SQLite as wasm in a worker, persisting to OPFS, and the
 *     backend connector is the JavaScript class in `platform.web.ts`.
 *   - **Desktop**: `@powersync/tauri-plugin` hands the database to Rust, which owns a real file on
 *     disk. The alpha SDK *cannot* connect from JavaScript — `db.connect()` throws — so the
 *     connector lives in Rust and JS only asks it to start (`platform.desktop.ts`).
 *
 * Vite aliases `@powersync-platform` to exactly one of those two files per build mode, so the
 * browser bundle never carries Tauri code and the desktop bundle never carries the wasm worker.
 * Both implementations are typed against `PowerSyncPlatform` below, which is what stops them
 * drifting apart.
 */
import type { CommonPowerSyncDatabase } from "@powersync/common";

export interface PowerSyncPlatform {
  /** The local replica. Every content read in the app goes through this. */
  readonly db: CommonPowerSyncDatabase;

  /**
   * Open the sync stream. Called once per sign-in, after the FTS index is built.
   *
   * Must be safe to call again after a failure: the caller treats a rejection as "still offline",
   * not as a fatal error.
   */
  connect(): Promise<void>;

  /**
   * Ask for a reconnect attempt because something changed in the world (the network came back,
   * the window was focused). No-op when not connected.
   */
  reconnect(): Promise<void>;

  /**
   * Stop the stream and forget this device's credentials, as part of sign-out. The replica itself
   * is cleared by the caller.
   */
  signOut(): Promise<void>;

  /**
   * Restore a session persisted outside the webview, before the auth client makes its first
   * request. No-op in the browser, where the session is a cookie.
   */
  restoreSession(): Promise<void>;
}
