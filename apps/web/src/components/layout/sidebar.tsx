/**
 * Left sidebar: workspace switcher, the Pages and Collections trees (folders and items, see
 * sidebar-tree.tsx), search/calendar/export, theme toggle, sign-out. The trees are PowerSync
 * reactive queries — they re-render instantly on any local or synced change. Creating/deleting a
 * page or collection is a local write; PowerSync uploads it. Creating a WORKSPACE is the
 * exception and goes through the API (see lib/workspaces.ts).
 */
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { signOut } from "../../lib/auth/client";
import { clearAuthToken } from "../../lib/auth/token";
import { clearSessionToken } from "../../lib/auth/session-token";
import { bootstrapWorkspaces } from "../../lib/bootstrap";
import { toDateKey } from "../../lib/calendar";
import { openDailyNote } from "../../lib/daily-note";
import { exportWorkspace } from "../../lib/export";
import { isDesktop } from "../../lib/platform";
import { disconnectAndClearDb } from "../../lib/powersync/client";
import { useVisibleWorkspaces } from "../../lib/use-workspaces";
import { createWorkspace } from "../../lib/workspaces";
import { hiddenIdsNow, usePendingDelete } from "../../stores/pending-delete";
import { useUiStore } from "../../stores/ui";
import { AiSettings } from "./ai-settings";
import { CollectionTree } from "./collection-tree";
import { FavoritesSection } from "./favorites-section";
import { NotificationToggle } from "./notification-toggle";
import { PageTree } from "./page-tree";
import { Personalization } from "./personalization";
import { WorkspaceSettings } from "./workspace-settings";
import { WorkspaceSwitcher } from "./workspace-switcher";

export function Sidebar() {
  const navigate = useNavigate();
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useUiStore((s) => s.setActiveWorkspace);
  const addKnownWorkspaceId = useUiStore((s) => s.addKnownWorkspaceId);
  const forgetWorkspaceId = useUiStore((s) => s.forgetWorkspaceId);
  const setKnownWorkspaceIds = useUiStore((s) => s.setKnownWorkspaceIds);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const [exporting, setExporting] = useState(false);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [personalizationOpen, setPersonalizationOpen] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);

  // Never count or offer a workspace the server doesn't acknowledge — the shared hook is where
  // that rule lives, so the calendar and the switcher can't drift apart (see lib/bootstrap.ts).
  const workspaces = useVisibleWorkspaces();
  const activeWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);

  /** Workspace creation needs the server (see lib/workspaces.ts), so it can fail — surface it. */
  async function handleNewWorkspace(name: string): Promise<void> {
    if (creatingWorkspace) return;
    setCreatingWorkspace(true);
    setWorkspaceError(null);
    try {
      const created = await createWorkspace(name);
      // Record it immediately — the authoritative list is only refreshed on boot.
      addKnownWorkspaceId(created.id);
      setActiveWorkspace(created.id);
      void navigate({ to: "/" });
    } catch {
      setWorkspaceError("Couldn't create the workspace. Check your connection and try again.");
    } finally {
      setCreatingWorkspace(false);
    }
  }

  function handleSwitchWorkspace(id: string): void {
    if (id === workspaceId) return;
    setActiveWorkspace(id);
    void navigate({ to: "/" });
  }

  /** Today's note, made on first open. "Today" is the device's own day (see lib/daily-note.ts). */
  async function handleDailyNote(): Promise<void> {
    if (!workspaceId) return;
    try {
      const pageId = await openDailyNote(workspaceId, toDateKey(new Date()), hiddenIdsNow());
      void navigate({ to: "/p/$pageId", params: { pageId } });
    } catch (err) {
      console.error("Opening the daily note failed", err);
    }
  }

  async function handleExport(): Promise<void> {
    if (!workspaceId || exporting) return;
    setExporting(true);
    try {
      await exportWorkspace(workspaceId);
    } catch (err) {
      console.error("Workspace export failed", err);
    } finally {
      setExporting(false);
    }
  }

  /**
   * The active workspace is no longer ours — deleted, left, or never really ours (a stale
   * replica row). Re-derive from the server rather than picking blindly from the replica,
   * which is exactly the source that can't be trusted here.
   */
  async function handleWorkspaceGone(): Promise<void> {
    setSettingsOpen(false);
    if (workspaceId) forgetWorkspaceId(workspaceId);
    try {
      const { activeId, knownIds } = await bootstrapWorkspaces();
      setKnownWorkspaceIds(knownIds);
      setActiveWorkspace(activeId);
    } catch {
      // Offline: fall back to any other workspace this device has.
      const next = workspaces.find((workspace) => workspace.id !== workspaceId);
      setActiveWorkspace(next?.id ?? null);
    }
    void navigate({ to: "/" });
  }

  async function handleSignOut(): Promise<void> {
    // A delete still inside its Undo window is written now, so it at least has a chance to
    // upload before the replica is cleared; if it does not make it, the rows come back.
    await usePendingDelete.getState().flush();
    await signOut();
    clearAuthToken();
    // Desktop only: drop the bearer session token too, so the next sign-in cannot inherit it.
    clearSessionToken();
    // Clears the replica, not just the stream — see disconnectAndClearDb for why.
    await disconnectAndClearDb();
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-line bg-surface">
      <WorkspaceSwitcher
        activeWorkspaceId={workspaceId}
        creating={creatingWorkspace}
        onSwitch={handleSwitchWorkspace}
        onCreate={(name) => void handleNewWorkspace(name)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {personalizationOpen ? (
        <Personalization onClose={() => setPersonalizationOpen(false)} />
      ) : null}
      {/* `isDesktop` first, so the browser build cannot reach this even if the state flag
          were somehow set. */}
      {isDesktop && aiSettingsOpen ? (
        <AiSettings onClose={() => setAiSettingsOpen(false)} />
      ) : null}

      {settingsOpen && workspaceId ? (
        <WorkspaceSettings
          workspaceId={workspaceId}
          workspaceName={activeWorkspace?.name ?? "Workspace"}
          isOnlyWorkspace={workspaces.length <= 1}
          onClose={() => setSettingsOpen(false)}
          onGone={() => void handleWorkspaceGone()}
        />
      ) : null}
      {workspaceError ? (
        <p role="alert" className="px-4 pb-2 text-xs text-danger">
          {workspaceError}
        </p>
      ) : null}

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <div className="mb-3 space-y-0.5">
          <SidebarButton label="Search…" hint="⌘K" onClick={() => setSearchOpen(true)} />
          <SidebarButton label="Calendar" onClick={() => navigate({ to: "/calendar" })} />
          <SidebarButton label="Focus" onClick={() => navigate({ to: "/focus" })} />
          <SidebarButton label="Daily recap" onClick={() => navigate({ to: "/recap" })} />
          <SidebarButton label="Daily note" onClick={() => void handleDailyNote()} />
        </div>

        <FavoritesSection workspaceId={workspaceId} />
        <PageTree workspaceId={workspaceId} />

        <CollectionTree workspaceId={workspaceId} />
      </nav>

      <div className="space-y-0.5 border-t border-line px-3 py-3">
        {/* Theme used to cycle from here. It lives inside Personalization now, beside the two
            other things that decide how the app looks — one row instead of three. */}
        <SidebarButton label="Personalization" onClick={() => setPersonalizationOpen(true)} />
        {/* Desktop only, and not a section of Personalization: which machine runs the AI is
            a capability, not a look. A browser has nothing to spawn and nothing to choose.
            The dialog itself carries no Tauri code — the engine seam keeps that out of the
            browser bundle (see lib/ai/engine-contract.ts). */}
        {isDesktop ? (
          <SidebarButton label="AI engine" onClick={() => setAiSettingsOpen(true)} />
        ) : null}
        <NotificationToggle />
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={exporting}
          className="w-full rounded-md px-2 py-1.5 text-left text-sm text-muted hover:bg-hover hover:text-fg disabled:opacity-50"
        >
          {exporting ? "Exporting…" : "Export"}
        </button>
        <button
          type="button"
          onClick={() => void handleSignOut()}
          className="w-full rounded-md px-2 py-1.5 text-left text-sm text-muted hover:bg-hover hover:text-fg"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}

function SidebarButton({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-muted hover:bg-hover hover:text-fg"
    >
      <span>{label}</span>
      {hint ? <span className="text-xs text-subtle">{hint}</span> : null}
    </button>
  );
}
