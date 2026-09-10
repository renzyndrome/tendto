/** UI-only state (Zustand). Content state lives in the PowerSync replica — never here. */
import { create } from "zustand";

import type { Source } from "../lib/ai/retrieve";
import { storeActiveWorkspaceId } from "../lib/workspaces";

interface UiState {
  sidebarOpen: boolean;
  activeWorkspaceId: string | null;
  /**
   * Workspace ids the SERVER says are the user's, or null when that isn't known (offline).
   * The replica can hold workspaces the server no longer agrees with — see bootstrap.ts — so
   * anything that lists workspaces filters against this when it is known.
   */
  knownWorkspaceIds: string[] | null;
  searchOpen: boolean;
  /**
   * How the open page editor accepts text, or null when no page is open.
   *
   * Registered by the editor and read by "Ask my notes", which lives in the command palette and
   * therefore has no editor of its own to write to. UI wiring, not content: nothing is written
   * until the user presses the button.
   */
  pageInsert: PageInsertTarget | null;
  toggleSidebar: () => void;
  setActiveWorkspace: (id: string | null) => void;
  setKnownWorkspaceIds: (ids: string[] | null) => void;
  /** Record a workspace this device just created or joined, before the next bootstrap. */
  addKnownWorkspaceId: (id: string) => void;
  forgetWorkspaceId: (id: string) => void;
  setSearchOpen: (open: boolean) => void;
  setPageInsert: (target: PageInsertTarget | null) => void;
}

export interface PageInsertTarget {
  pageId: string;
  insert: (text: string, sources: readonly Source[]) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  activeWorkspaceId: null,
  knownWorkspaceIds: null,
  searchOpen: false,
  pageInsert: null,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  // Persisted so switching workspaces survives a reload (see bootstrapWorkspaces).
  setActiveWorkspace: (id) => {
    storeActiveWorkspaceId(id);
    set({ activeWorkspaceId: id });
  },
  setKnownWorkspaceIds: (ids) => set({ knownWorkspaceIds: ids }),
  addKnownWorkspaceId: (id) =>
    set((s) => ({
      knownWorkspaceIds:
        s.knownWorkspaceIds && !s.knownWorkspaceIds.includes(id)
          ? [...s.knownWorkspaceIds, id]
          : s.knownWorkspaceIds,
    })),
  forgetWorkspaceId: (id) =>
    set((s) => ({
      knownWorkspaceIds: s.knownWorkspaceIds?.filter((known) => known !== id) ?? null,
    })),
  setSearchOpen: (open) => set({ searchOpen: open }),
  setPageInsert: (target) => set({ pageInsert: target }),
}));
