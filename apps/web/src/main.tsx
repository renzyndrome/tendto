import { PowerSyncContext } from "@powersync/react";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { connectDb, db } from "./lib/powersync/client";
import { router } from "./routes/router";
import "./index.css";

// Fire-and-forget: the app renders instantly from the local replica;
// sync connects in the background.
void connectDb();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PowerSyncContext.Provider value={db}>
      <RouterProvider router={router} />
    </PowerSyncContext.Provider>
  </StrictMode>,
);
