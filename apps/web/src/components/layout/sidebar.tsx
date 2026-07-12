/**
 * Left sidebar: active workspace, reactive Pages + Collections lists, "new" actions, sign-out.
 *
 * The lists are PowerSync reactive queries — they re-render instantly whenever the local `pages`
 * / `collections` tables change (local edit or synced-down change). Creating a page or collection
 * is a local INSERT; PowerSync uploads it. No content read/write here touches the network directly.
 */
import { useQuery } from "@powersync/react";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";

import { signOut } from "../../lib/auth/client";
import { clearAuthToken } from "../../lib/auth/token";
import { exportWorkspace } from "../../lib/export";
import { db } from "../../lib/powersync/client";
import { useUiStore } from "../../stores/ui";

interface WorkspaceRow {
  id: string;
  name: string;
}

interface NamedRow {
  id: string;
  name: string;
}

interface PageRow {
  id: string;
  title: string;
}

async function nextPagePosition(workspaceId: string): Promise<number> {
  const rows = await db.getAll<{ next: number | null }>(
    "SELECT MAX(position) AS next FROM pages WHERE workspace_id = ?",
    [workspaceId],
  );
  return (rows[0]?.next ?? -1) + 1;
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
    "SELECT id, title FROM pages WHERE workspace_id = ? ORDER BY position",
    [workspaceId ?? ""],
  );
  const { data: collections } = useQuery<NamedRow>(
    "SELECT id, name FROM collections WHERE workspace_id = ? ORDER BY created_at",
    [workspaceId ?? ""],
  );

  const workspaceName = workspaces[0]?.name ?? "Workspace";

  async function handleNewPage() {
    if (!workspaceId) return;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const position = await nextPagePosition(workspaceId);
    await db.execute(
      `INSERT INTO pages (id, workspace_id, parent_id, title, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, workspaceId, null, "Untitled", position, now, now],
    );
    void navigate({ to: "/p/$pageId", params: { pageId: id } });
  }

  async function handleNewCollection() {
    if (!workspaceId) return;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO collections (id, workspace_id, name, default_view, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, workspaceId, "Untitled", "board", now, now],
    );
    void navigate({ to: "/c/$collectionId", params: { collectionId: id } });
  }

  async function handleExport() {
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

  async function handleSignOut() {
    await signOut();
    clearAuthToken();
    // Stop syncing with a now-invalid token. (Local data is kept so re-login stays instant;
    // a shared-device flow would instead `disconnectAndClear()` on a different user's sign-in.)
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
        </div>

        <SidebarSection
          label="Pages"
          onNew={handleNewPage}
          newLabel="New page"
          empty={pages.length === 0 ? "No pages yet" : null}
        >
          {pages.map((page) => (
            <SidebarLink
              key={page.id}
              label={page.title || "Untitled"}
              onClick={() => navigate({ to: "/p/$pageId", params: { pageId: page.id } })}
            />
          ))}
        </SidebarSection>

        <SidebarSection
          label="Collections"
          onNew={handleNewCollection}
          newLabel="New collection"
          empty={collections.length === 0 ? "No collections yet" : null}
        >
          {collections.map((collection) => (
            <SidebarLink
              key={collection.id}
              label={collection.name || "Untitled"}
              onClick={() =>
                navigate({ to: "/c/$collectionId", params: { collectionId: collection.id } })
              }
            />
          ))}
        </SidebarSection>
      </nav>

      <div className="space-y-0.5 border-t border-neutral-200 px-3 py-3">
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="w-full rounded-md px-2 py-1.5 text-left text-sm text-neutral-500 hover:bg-neutral-200/60 hover:text-neutral-900 disabled:opacity-50"
        >
          {exporting ? "Exporting…" : "Export"}
        </button>
        <button
          type="button"
          onClick={handleSignOut}
          className="w-full rounded-md px-2 py-1.5 text-left text-sm text-neutral-500 hover:bg-neutral-200/60 hover:text-neutral-900"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}

interface SidebarSectionProps {
  label: string;
  newLabel: string;
  onNew: () => void;
  empty: string | null;
  children: ReactNode;
}

function SidebarSection({ label, newLabel, onNew, empty, children }: SidebarSectionProps) {
  return (
    <section className="mb-4">
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
      <ul className="space-y-0.5">
        {children}
        {empty ? <li className="px-2 py-1.5 text-sm text-neutral-400">{empty}</li> : null}
      </ul>
    </section>
  );
}

interface SidebarButtonProps {
  label: string;
  hint?: string;
  onClick: () => void;
}

/** A standalone top-level nav row (Search, Calendar) — not part of a list section. */
function SidebarButton({ label, hint, onClick }: SidebarButtonProps) {
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

function SidebarLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-200/60"
      >
        {label}
      </button>
    </li>
  );
}
