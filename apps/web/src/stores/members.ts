/**
 * Workspace members cache (Zustand). Members come from FastAPI (the membership lifecycle + display
 * names live server-side), cached per workspace so the assignee picker + board avatars can resolve
 * user ids → people without refetching. `useWorkspaceMembers` loads on demand and returns the list
 * plus a fast id→member lookup. Offline: falls back to whatever was last cached (else empty).
 */
import { useEffect } from "react";
import { create } from "zustand";

import { listMembers, type MemberInfo } from "../lib/workspaces";

interface MembersState {
  byWorkspace: Record<string, MemberInfo[]>;
  loading: Record<string, boolean>;
  load: (workspaceId: string, force?: boolean) => Promise<void>;
}

const useMembersStore = create<MembersState>((set, get) => ({
  byWorkspace: {},
  loading: {},
  load: async (workspaceId, force = false) => {
    if (!workspaceId) return;
    const state = get();
    if (state.loading[workspaceId]) return;
    if (!force && state.byWorkspace[workspaceId]) return;
    set((s) => ({ loading: { ...s.loading, [workspaceId]: true } }));
    try {
      const { members } = await listMembers(workspaceId);
      set((s) => ({ byWorkspace: { ...s.byWorkspace, [workspaceId]: members } }));
    } catch {
      // offline / API down — keep any previously cached members
    } finally {
      set((s) => ({ loading: { ...s.loading, [workspaceId]: false } }));
    }
  },
}));

export interface WorkspaceMembers {
  members: MemberInfo[];
  byId: Map<string, MemberInfo>;
  refresh: () => void;
}

export function useWorkspaceMembers(workspaceId: string | null): WorkspaceMembers {
  const members = useMembersStore((s) => (workspaceId ? s.byWorkspace[workspaceId] : undefined));
  const load = useMembersStore((s) => s.load);

  useEffect(() => {
    if (workspaceId) void load(workspaceId);
  }, [workspaceId, load]);

  const list = members ?? [];
  return {
    members: list,
    byId: new Map(list.map((m) => [m.user_id, m])),
    refresh: () => {
      if (workspaceId) void load(workspaceId, true);
    },
  };
}
