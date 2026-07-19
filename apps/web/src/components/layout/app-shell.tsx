/**
 * App shell: a persistent sidebar (a slide-in drawer on mobile) + routed main area, the global
 * search palette (⌘K), and first-run onboarding (welcome dialog → coach tour). Canvas is Meadow
 * warm paper; the sidebar is the panel tone.
 */
import { Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { createPage } from "../../lib/pages";
import { useUiStore } from "../../stores/ui";
import { Onboarding } from "../onboarding/onboarding";
import { SearchPalette } from "../search/search-palette";
import { ShareModal } from "../workspace/share-modal";
import { Sidebar } from "./sidebar";

export function AppShell() {
  const navigate = useNavigate();
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      } else if (mod && event.key.toLowerCase() === "n" && workspaceId) {
        event.preventDefault();
        void createPage(workspaceId, null).then((id) =>
          navigate({ to: "/p/$pageId", params: { pageId: id } }),
        );
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSearchOpen, workspaceId, navigate]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-canvas text-ink">
      {/* Desktop: persistent sidebar */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* Mobile: slide-in drawer */}
      {sidebarOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-[rgba(31,29,24,.28)]"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 animate-pop-in shadow-menu">
            <Sidebar />
          </div>
        </div>
      ) : null}

      <main data-tour="canvas" className="h-full flex-1 overflow-y-auto">
        <Outlet />
      </main>

      <SearchPalette />
      <ShareModal />
      <Onboarding />
    </div>
  );
}
