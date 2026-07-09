/** UI-only state (Zustand). Content state lives in the PowerSync replica — never here. */
import { create } from "zustand";

interface UiState {
  sidebarOpen: boolean;
  activeWorkspaceId: string | null;
  toggleSidebar: () => void;
  setActiveWorkspace: (id: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  activeWorkspaceId: null,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
}));
