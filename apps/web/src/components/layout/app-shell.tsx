/** App shell: persistent sidebar + routed main area + global search palette (Cmd/Ctrl+K). */
import { Outlet } from "@tanstack/react-router";
import { useEffect } from "react";

import { startDueWatcher } from "../../lib/items/due-watcher";
import { startRecapWatcher } from "../../lib/recap-schedule";
import { router } from "../../routes/router";
import { useUiStore } from "../../stores/ui";
import { SearchPalette } from "../search/search-palette";
import { Sidebar } from "./sidebar";

export function AppShell() {
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);

  // Due reminders run for as long as the app is open. Reads the active workspace lazily via
  // the store so switching workspaces doesn't restart the timer.
  useEffect(
    () => startDueWatcher(() => useUiStore.getState().activeWorkspaceId),
    [],
  );

  // The ambient half of the daily summary: at the configured hour it fetches today's recap
  // once and notifies. Device-local for the same reasons the due watcher is — see
  // lib/recap-schedule.ts.
  useEffect(
    () => startRecapWatcher(() => void router.navigate({ to: "/recap" })),
    [],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSearchOpen]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-app text-fg">
      <Sidebar />
      <main className="h-full flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <SearchPalette />
    </div>
  );
}
