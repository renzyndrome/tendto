/**
 * Left sidebar (Meadow) — brand tile + workspace, an inset Search field, primary nav
 * (Home / Calendar / Focus / Settings), a nested Pages tree + Collections list, and a subtle
 * sync-status footer. Lists are PowerSync reactive queries — they re-render instantly on any
 * local or synced change. Creating/deleting is a local write; PowerSync uploads it.
 */
import { useQuery } from "@powersync/react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  createCollection,
  deleteCollectionCascade,
  type CollectionTemplate,
} from "../../lib/collections";
import { createPage, deletePageCascade } from "../../lib/pages";
import { useUiStore } from "../../stores/ui";
import { NewCollectionModal } from "../collection/new-collection-modal";
import { Icon, type IconName } from "../ui/icon";
import { Kbd } from "../ui/kbd";
import { SyncStatus } from "./sync-status";
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
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const [pickingTemplate, setPickingTemplate] = useState(false);

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

  function go(to: string): void {
    setSidebarOpen(false); // close the mobile drawer on navigate
    void navigate({ to });
  }

  async function handleNewPage(parentId: string | null): Promise<void> {
    if (!workspaceId) return;
    const id = await createPage(workspaceId, parentId);
    go(`/p/${id}`);
  }

  async function handleDeletePage(pageId: string, title: string): Promise<void> {
    if (!window.confirm(`Delete "${title || "Untitled"}" and any subpages?`)) return;
    await deletePageCascade(pageId);
    void navigate({ to: "/" });
  }

  async function handleNewCollection(template: CollectionTemplate): Promise<void> {
    if (!workspaceId) return;
    setPickingTemplate(false);
    const id = await createCollection(workspaceId, template);
    go(`/c/${id}`);
  }

  async function handleDeleteCollection(collectionId: string, name: string): Promise<void> {
    if (!window.confirm(`Delete "${name || "Untitled"}" and its items?`)) return;
    await deleteCollectionCascade(collectionId);
    void navigate({ to: "/" });
  }

  return (
    <aside className="flex h-full w-sidebar shrink-0 flex-col border-r border-hairline bg-panel">
      {/* Brand + workspace switcher */}
      <WorkspaceSwitcher />

      {/* Search field (inset card) */}
      <button
        type="button"
        data-tour="search"
        onClick={() => setSearchOpen(true)}
        className="mx-3 mb-3.5 flex items-center gap-2 rounded-input border border-border-soft bg-canvas px-2.5 py-[7px] text-[12.5px] text-muted hover:border-border-hover"
      >
        <Icon name="search" size={13} />
        <span>Search</span>
        <Kbd className="ml-auto">⌘K</Kbd>
      </button>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        <div className="mb-2 space-y-px">
          <NavRow icon="home" label="Home" onClick={() => go("/")} />
          <NavRow icon="calendar" label="Calendar" onClick={() => go("/calendar")} />
          <NavRow icon="focus" label="Focus" onClick={() => go("/focus")} />
          <NavRow icon="settings" label="Settings" onClick={() => go("/settings")} />
        </div>

        <SectionHeader label="Pages" />
        <div className="mb-3">
          {rootPages.length === 0 ? (
            <p className="px-2.5 py-1.5 text-[12.5px] text-faint">No pages yet</p>
          ) : (
            rootPages.map((page) => (
              <PageNode
                key={page.id}
                page={page}
                childrenByParent={childrenByParent}
                depth={0}
                onOpen={(id) => go(`/p/${id}`)}
                onAddSub={(id) => void handleNewPage(id)}
                onDelete={(id, title) => void handleDeletePage(id, title)}
              />
            ))
          )}
          <button
            type="button"
            data-tour="new-page"
            onClick={() => void handleNewPage(null)}
            className="flex w-full items-center gap-1.5 rounded-row px-2.5 py-1.5 text-[13px] text-muted row-hover"
          >
            <Icon name="plus" size={13} className="text-faint" />
            New page
          </button>
        </div>

        <SectionHeader label="Collections" />
        <div className="mb-3">
          {collections.length === 0 ? (
            <p className="px-2.5 py-1.5 text-[12.5px] text-faint">No collections yet</p>
          ) : (
            collections.map((collection) => (
              <CollectionRowItem
                key={collection.id}
                label={collection.name || "Untitled"}
                onOpen={() => go(`/c/${collection.id}`)}
                onDelete={() => void handleDeleteCollection(collection.id, collection.name)}
              />
            ))
          )}
          <button
            type="button"
            onClick={() => setPickingTemplate(true)}
            className="flex w-full items-center gap-1.5 rounded-row px-2.5 py-1.5 text-[13px] text-muted row-hover"
          >
            <Icon name="plus" size={13} className="text-faint" />
            New collection
          </button>
        </div>
      </nav>

      <SyncStatus />

      {pickingTemplate ? (
        <NewCollectionModal
          onPick={(template) => void handleNewCollection(template)}
          onClose={() => setPickingTemplate(false)}
        />
      ) : null}
    </aside>
  );
}

/** Active state matches on the current path so the open page/collection row is highlighted. */
function useActivePath(): string {
  return useRouterState({ select: (s) => s.location.pathname });
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
  const active = useActivePath() === `/p/${page.id}`;

  return (
    <div>
      <div
        className={
          "group flex items-center gap-1.5 rounded-row pr-1 " +
          (active ? "bg-accent-soft" : "row-hover")
        }
        style={{ paddingLeft: 10 + depth * 18 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? "Collapse" : "Expand"}
            className={"w-3 shrink-0 text-[9px] " + (active ? "text-accent-glyph" : "text-faint")}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-3 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          onClick={() => onOpen(page.id)}
          className={
            "flex-1 truncate py-1.5 text-left " +
            (depth > 0 ? "text-[12.5px] " : "text-[13px] ") +
            (active ? "font-medium text-accent-soft-text" : "text-secondary")
          }
        >
          {page.title || "Untitled"}
        </button>
        <button
          type="button"
          onClick={() => onAddSub(page.id)}
          aria-label="Add subpage"
          title="Add subpage"
          className="invisible shrink-0 rounded p-0.5 text-faint hover:text-ink group-hover:visible"
        >
          <Icon name="plus" size={13} />
        </button>
        <button
          type="button"
          onClick={() => onDelete(page.id, page.title)}
          aria-label="Delete page"
          title="Delete page"
          className="invisible shrink-0 rounded p-0.5 text-faint hover:text-overdue group-hover:visible"
        >
          <Icon name="close" size={13} />
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

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="mb-1 mt-2 px-2.5 py-1">
      <span className="text-section-label uppercase text-faint">{label}</span>
    </div>
  );
}

function CollectionRowItem({
  label,
  onOpen,
  onDelete,
}: {
  label: string;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group flex items-center rounded-row row-hover">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-1.5 text-left text-[13px] text-secondary"
      >
        <Icon name="board" size={13} className="shrink-0 text-faint" />
        <span className="truncate">{label}</span>
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete collection"
        title="Delete collection"
        className="invisible shrink-0 rounded p-0.5 pr-1.5 text-faint hover:text-overdue group-hover:visible"
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}

function NavRow({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  const active = useActivePath() === (label === "Home" ? "/" : `/${label.toLowerCase()}`);
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex w-full items-center gap-2.5 rounded-row px-2.5 py-1.5 text-left text-[13px] " +
        (active ? "bg-accent-soft font-medium text-accent-soft-text" : "text-secondary row-hover")
      }
    >
      <Icon name={icon} size={15} className={active ? "text-accent-soft-text" : "text-muted"} />
      {label}
    </button>
  );
}
