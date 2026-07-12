/** UI-only state (Zustand). Content state lives in the PowerSync replica — never here. */
import { create } from "zustand";

interface UiState {
  sidebarOpen: boolean;
  activeWorkspaceId: string | null;
  searchOpen: boolean;
  toggleSidebar: () => void;
  setActiveWorkspace: (id: string | null) => void;
  setSearchOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  activeWorkspaceId: null,
  searchOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
  setSearchOpen: (open) => set({ searchOpen: open }),
}));
