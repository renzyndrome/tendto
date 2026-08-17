import { PowerSyncContext } from "@powersync/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import { db } from "./lib/powersync/client";
import { watchSystemTheme } from "./stores/theme";
import "./index.css";

// Keep "system" theme following the OS for the app's lifetime. The initial class is already
// on <html> from the inline script in index.html (which runs before first paint).
watchSystemTheme();

// The app renders from the local replica. Auth-gating, bootstrap, and `connectDb()` happen
// inside <App /> once a session exists — see app.tsx.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PowerSyncContext.Provider value={db}>
      <App />
    </PowerSyncContext.Provider>
  </StrictMode>,
);
