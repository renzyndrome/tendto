import { PowerSyncContext } from "@powersync/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import { db } from "./lib/powersync/client";
import "./index.css";

// The app renders from the local replica. Auth-gating, bootstrap, and `connectDb()` happen
// inside <App /> once a session exists — see app.tsx.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PowerSyncContext.Provider value={db}>
      <App />
    </PowerSyncContext.Provider>
  </StrictMode>,
);
