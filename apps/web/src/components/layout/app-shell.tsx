/** App shell: persistent sidebar + routed main area + global search palette (Cmd/Ctrl+K). */
import { Outlet } from "@tanstack/react-router";
import { useEffect } from "react";

import { useUiStore } from "../../stores/ui";
import { SearchPalette } from "../search/search-palette";
import { Sidebar } from "./sidebar";

export function AppShell() {
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);

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
    <div className="flex h-screen w-screen overflow-hidden bg-white text-neutral-900">
      <Sidebar />
      <main className="h-full flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <SearchPalette />
    </div>
  );
}
