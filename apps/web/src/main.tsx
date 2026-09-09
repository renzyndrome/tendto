import { PowerSyncContext } from "@powersync/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import { db, restoreSession } from "./lib/powersync/client";
import { primeDesktopNotifications } from "./lib/notifications";
import { installServiceWorker } from "./lib/pwa";
import { watchSystemTheme } from "./stores/theme";
import "./index.css";

// Keep "system" theme following the OS for the app's lifetime. The initial class is already
// on <html> from the inline script in index.html (which runs before first paint).
watchSystemTheme();

// Offline cold boot: the service worker precaches the bundle and the SQLite wasm, so the
// app opens with no network. Also schedules the periodic update check — see lib/pwa.ts.
installServiceWorker();

// Desktop only: read the OS notification permission once, so the synchronous
// permissionState() the toggle and the watchers call has something true to report.
void primeDesktopNotifications();

// Must finish BEFORE the first render: <App /> asks better-auth for the session as soon as it
// mounts, and on the desktop the session token lives in Rust rather than in a cookie. Restoring
// it afterwards would make every restart flash the sign-in screen. In the browser this resolves
// immediately — there is nothing to restore.
try {
  await restoreSession();
} catch (error) {
  // Never block the first render on this. A failure here means the desktop starts signed out,
  // which the user can fix by signing in; an unhandled rejection would leave a blank window with
  // nothing to act on, because this runs before React exists to catch it.
  console.error("Could not restore the stored session", error);
}

// The app renders from the local replica. Auth-gating, bootstrap, and `connectDb()` happen
// inside <App /> once a session exists — see app.tsx.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PowerSyncContext.Provider value={db}>
      <App />
    </PowerSyncContext.Provider>
  </StrictMode>,
);
