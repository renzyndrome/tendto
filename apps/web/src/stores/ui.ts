/** UI-only state (Zustand). Content state lives in the PowerSync replica — never here. */
import { create } from "zustand";

interface UiState {
  /** Mobile sidebar drawer open state. On desktop the sidebar is always visible (CSS). */
  sidebarOpen: boolean;
  activeWorkspaceId: string | null;
  searchOpen: boolean;
  shareOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setActiveWorkspace: (id: string | null) => void;
  setSearchOpen: (open: boolean) => void;
  setShareOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: false,
  activeWorkspaceId: null,
  searchOpen: false,
  shareOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
  setSearchOpen: (open) => set({ searchOpen: open }),
  setShareOpen: (open) => set({ shareOpen: open }),
}));
