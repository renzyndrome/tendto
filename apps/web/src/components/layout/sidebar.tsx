/**
 * Left sidebar: active workspace, a nested Pages tree + Collections list, create/delete actions,
 * search/calendar/export, sign-out. Lists are PowerSync reactive queries — they re-render instantly
 * on any local or synced change. Creating/deleting is a local write; PowerSync uploads it.
 */
import { useQuery } from "@powersync/react";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { signOut } from "../../lib/auth/client";
import { clearAuthToken } from "../../lib/auth/token";
import { createCollection, deleteCollectionCascade } from "../../lib/collections";
import { exportWorkspace } from "../../lib/export";
import { createPage, deletePageCascade } from "../../lib/pages";
import { db } from "../../lib/powersync/client";
import { useUiStore } from "../../stores/ui";

interface WorkspaceRow {
  id: string;
  name: string;
}

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
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const [exporting, setExporting] = useState(false);

  const { data: workspaces } = useQuery<WorkspaceRow>(
    "SELECT id, name FROM workspaces WHERE id = ?",
    [workspaceId ?? ""],
  );
  const { data: pages } = useQuery<PageRow>(
    "SELECT id, title, parent_id FROM pages WHERE workspace_id = ? ORDER BY position",
    [workspaceId ?? ""],
  );
  const { data: collections } = useQuery<CollectionRow>(
    "SELECT id, name FROM collections WHERE workspace_id = ? ORDER BY created_at",
    [workspaceId ?? ""],
  );

  const workspaceName = workspaces[0]?.name ?? "Workspace";

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

  async function handleSignOut(): Promise<void> {
    await signOut();
    clearAuthToken();
    try {
      await db.disconnect();
    } catch {
      // already disconnected — ignore
    }
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50">
      <div className="px-4 py-4">
        <span className="block truncate text-sm font-semibold text-neutral-900">
          {workspaceName}
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <div className="mb-3 space-y-0.5">
          <SidebarButton label="Search…" hint="⌘K" onClick={() => setSearchOpen(true)} />
          <SidebarButton label="Calendar" onClick={() => navigate({ to: "/calendar" })} />
          <SidebarButton label="Focus" onClick={() => navigate({ to: "/focus" })} />
        </div>

        <SectionHeader label="Pages" newLabel="New page" onNew={() => void handleNewPage(null)} />
        <div className="mb-4">
          {rootPages.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-neutral-400">No pages yet</p>
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
            <p className="px-2 py-1.5 text-sm text-neutral-400">No collections yet</p>
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

      <div className="space-y-0.5 border-t border-neutral-200 px-3 py-3">
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={exporting}
          className="w-full rounded-md px-2 py-1.5 text-left text-sm text-neutral-500 hover:bg-neutral-200/60 hover:text-neutral-900 disabled:opacity-50"
        >
          {exporting ? "Exporting…" : "Export"}
        </button>
        <button
          type="button"
          onClick={() => void handleSignOut()}
          className="w-full rounded-md px-2 py-1.5 text-left text-sm text-neutral-500 hover:bg-neutral-200/60 hover:text-neutral-900"
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
        className="group flex items-center gap-1 rounded-md pr-1 hover:bg-neutral-200/60"
        style={{ paddingLeft: depth * 12 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? "Collapse" : "Expand"}
            className="w-4 shrink-0 text-xs text-neutral-400"
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-4 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          onClick={() => onOpen(page.id)}
          className="flex-1 truncate py-1.5 text-left text-sm text-neutral-700"
        >
          {page.title || "Untitled"}
        </button>
        <button
          type="button"
          onClick={() => onAddSub(page.id)}
          aria-label="Add subpage"
          title="Add subpage"
          className="invisible shrink-0 rounded px-1 text-neutral-400 hover:text-neutral-800 group-hover:visible"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => onDelete(page.id, page.title)}
          aria-label="Delete page"
          title="Delete page"
          className="invisible shrink-0 rounded px-1 text-neutral-400 hover:text-red-500 group-hover:visible"
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
      <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</span>
      <button
        type="button"
        onClick={onNew}
        aria-label={newLabel}
        title={newLabel}
        className="rounded px-1 text-base leading-none text-neutral-400 hover:bg-neutral-200/60 hover:text-neutral-700"
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
    <div className="group flex items-center rounded-md pr-1 hover:bg-neutral-200/60">
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 truncate px-2 py-1.5 text-left text-sm text-neutral-700"
      >
        {label}
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={deleteLabel}
        title={deleteLabel}
        className="invisible shrink-0 rounded px-1 text-neutral-400 hover:text-red-500 group-hover:visible"
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
      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-neutral-600 hover:bg-neutral-200/60 hover:text-neutral-900"
    >
      <span>{label}</span>
      {hint ? <span className="text-xs text-neutral-400">{hint}</span> : null}
    </button>
  );
}
