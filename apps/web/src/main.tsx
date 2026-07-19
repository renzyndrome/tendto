import { PowerSyncContext } from "@powersync/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Self-hosted fonts (offline-first): Albert Sans (UI + doc sans) and Source Serif 4 (doc serif).
import "@fontsource/albert-sans/400.css";
import "@fontsource/albert-sans/500.css";
import "@fontsource/albert-sans/600.css";
import "@fontsource/albert-sans/700.css";
import "@fontsource/source-serif-4/400.css";
import "@fontsource/source-serif-4/400-italic.css";
import "@fontsource/source-serif-4/600.css";

import { App } from "./app";
import { db } from "./lib/powersync/client";
import { bootstrapTheme } from "./lib/prefs/apply-theme";
import "./index.css";

// Stamp the persisted Appearance theme onto <html> before first paint (no flash) and keep the
// resolved light/dark mode in sync with the OS while the preference is "system".
bootstrapTheme();

// The app renders from the local replica. Auth-gating, bootstrap, and `connectDb()` happen
// inside <App /> once a session exists — see app.tsx.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PowerSyncContext.Provider value={db}>
      <App />
    </PowerSyncContext.Provider>
  </StrictMode>,
);
