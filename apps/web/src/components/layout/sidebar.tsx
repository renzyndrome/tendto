/**
 * Left sidebar: workspace switcher, a nested Pages tree + Collections list, create/delete
 * actions, search/calendar/export, theme toggle, sign-out. Lists are PowerSync reactive
 * queries — they re-render instantly on any local or synced change. Creating/deleting a page
 * or collection is a local write; PowerSync uploads it. Creating a WORKSPACE is the exception
 * and goes through the API (see lib/workspaces.ts).
 */
import { useQuery } from "@powersync/react";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { signOut } from "../../lib/auth/client";
import { clearAuthToken } from "../../lib/auth/token";
import { bootstrapWorkspaces } from "../../lib/bootstrap";
import { createCollection, deleteCollectionCascade } from "../../lib/collections";
import { exportWorkspace } from "../../lib/export";
import { createPage, deletePageCascade } from "../../lib/pages";
import { disconnectAndClearDb } from "../../lib/powersync/client";
import { useVisibleWorkspaces } from "../../lib/use-workspaces";
import { createWorkspace } from "../../lib/workspaces";
import { useUiStore } from "../../stores/ui";
import { NotificationToggle } from "./notification-toggle";
import { ThemeToggle } from "./theme-toggle";
import { WorkspaceSettings } from "./workspace-settings";
import { WorkspaceSwitcher } from "./workspace-switcher";

interface CollectionRow {
  id: string;
  name: string;
}

interface PageRow {
  id: string;
  title: string;
  parent_id: string | null;
}

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

  // Never count or offer a workspace the server doesn't acknowledge — the shared hook is where
  // that rule lives, so the calendar and the switcher can't drift apart (see lib/bootstrap.ts).
  const workspaces = useVisibleWorkspaces();
  const activeWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);

  const { data: pages } = useQuery<PageRow>(
    "SELECT id, title, parent_id FROM pages WHERE workspace_id = ? ORDER BY position",
    [workspaceId ?? ""],
  );
  const { data: collections } = useQuery<CollectionRow>(
    "SELECT id, name FROM collections WHERE workspace_id = ? ORDER BY created_at",
    [workspaceId ?? ""],
  );

  // Group pages by parent for the tree (null parent = top level).
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, PageRow[]>();
    for (const page of pages) {
      const key = page.parent_id ?? null;
      const list = map.get(key) ?? [];
      list.push(page);
      map.set(key, list);
    }
    return map;
  }, [pages]);
  const rootPages = childrenByParent.get(null) ?? [];

  async function handleNewPage(parentId: string | null): Promise<void> {
    if (!workspaceId) return;
    const id = await createPage(workspaceId, parentId);
    void navigate({ to: "/p/$pageId", params: { pageId: id } });
  }

  async function handleDeletePage(pageId: string, title: string): Promise<void> {
    if (!window.confirm(`Delete "${title || "Untitled"}" and any subpages?`)) return;
    await deletePageCascade(pageId);
    void navigate({ to: "/" });
  }

  async function handleNewCollection(): Promise<void> {
    if (!workspaceId) return;
    const id = await createCollection(workspaceId);
    void navigate({ to: "/c/$collectionId", params: { collectionId: id } });
  }

  async function handleDeleteCollection(collectionId: string, name: string): Promise<void> {
    if (!window.confirm(`Delete "${name || "Untitled"}" and its items?`)) return;
    await deleteCollectionCascade(collectionId);
    void navigate({ to: "/" });
  }

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
    await signOut();
    clearAuthToken();
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
        </div>

        <SectionHeader label="Pages" newLabel="New page" onNew={() => void handleNewPage(null)} />
        <div className="mb-4">
          {rootPages.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-subtle">No pages yet</p>
          ) : (
            rootPages.map((page) => (
              <PageNode
                key={page.id}
                page={page}
                childrenByParent={childrenByParent}
                depth={0}
                onOpen={(id) => navigate({ to: "/p/$pageId", params: { pageId: id } })}
                onAddSub={(id) => void handleNewPage(id)}
                onDelete={(id, title) => void handleDeletePage(id, title)}
              />
            ))
          )}
        </div>

        <SectionHeader
          label="Collections"
          newLabel="New collection"
          onNew={() => void handleNewCollection()}
        />
        <div className="mb-4 space-y-0.5">
          {collections.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-subtle">No collections yet</p>
          ) : (
            collections.map((collection) => (
              <RowWithDelete
                key={collection.id}
                label={collection.name || "Untitled"}
                deleteLabel="Delete collection"
                onOpen={() =>
                  navigate({ to: "/c/$collectionId", params: { collectionId: collection.id } })
                }
                onDelete={() => void handleDeleteCollection(collection.id, collection.name)}
              />
            ))
          )}
        </div>
      </nav>

      <div className="space-y-0.5 border-t border-line px-3 py-3">
        <ThemeToggle />
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

interface PageNodeProps {
  page: PageRow;
  childrenByParent: Map<string | null, PageRow[]>;
  depth: number;
  onOpen: (id: string) => void;
  onAddSub: (id: string) => void;
  onDelete: (id: string, title: string) => void;
}

function PageNode({ page, childrenByParent, depth, onOpen, onAddSub, onDelete }: PageNodeProps) {
  const children = childrenByParent.get(page.id) ?? [];
  const [expanded, setExpanded] = useState(true);
  const hasChildren = children.length > 0;

  return (
    <div>
      <div
        className="group flex items-center gap-1 rounded-md pr-1 hover:bg-hover"
        style={{ paddingLeft: depth * 12 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? "Collapse" : "Expand"}
            className="w-4 shrink-0 text-xs text-subtle"
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-4 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          onClick={() => onOpen(page.id)}
          className="flex-1 truncate py-1.5 text-left text-sm text-muted"
        >
          {page.title || "Untitled"}
        </button>
        <button
          type="button"
          onClick={() => onAddSub(page.id)}
          aria-label="Add subpage"
          title="Add subpage"
          className="invisible shrink-0 rounded px-1 text-subtle hover:text-fg group-hover:visible"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => onDelete(page.id, page.title)}
          aria-label="Delete page"
          title="Delete page"
          className="invisible shrink-0 rounded px-1 text-subtle hover:text-danger group-hover:visible"
        >
          ×
        </button>
      </div>
      {hasChildren && expanded
        ? children.map((child) => (
            <PageNode
              key={child.id}
              page={child}
              childrenByParent={childrenByParent}
              depth={depth + 1}
              onOpen={onOpen}
              onAddSub={onAddSub}
              onDelete={onDelete}
            />
          ))
        : null}
    </div>
  );
}

function SectionHeader({
  label,
  newLabel,
  onNew,
}: {
  label: string;
  newLabel: string;
  onNew: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-2 py-1">
      <span className="text-xs font-medium uppercase tracking-wide text-subtle">{label}</span>
      <button
        type="button"
        onClick={onNew}
        aria-label={newLabel}
        title={newLabel}
        className="rounded px-1 text-base leading-none text-subtle hover:bg-hover hover:text-fg"
      >
        +
      </button>
    </div>
  );
}

function RowWithDelete({
  label,
  deleteLabel,
  onOpen,
  onDelete,
}: {
  label: string;
  deleteLabel: string;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group flex items-center rounded-md pr-1 hover:bg-hover">
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 truncate px-2 py-1.5 text-left text-sm text-muted"
      >
        {label}
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={deleteLabel}
        title={deleteLabel}
        className="invisible shrink-0 rounded px-1 text-subtle hover:text-danger group-hover:visible"
      >
        ×
      </button>
    </div>
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
