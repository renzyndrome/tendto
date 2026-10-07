/**
 * The sidebar's Pages section: folders and pages in one tree, worked like an editor's file
 * explorer.
 *
 * - Click a row to highlight it. The open page is highlighted on its own.
 * - "New page" / "New folder" in the header create inside the highlighted folder, beside a
 *   highlighted page, or at the top level when nothing is highlighted (click empty space).
 * - A new folder is named in place; double-click a folder to rename it.
 * - Drag a row onto a folder to move it in, or onto the header or empty space to move it out.
 *
 * Everything reads from the local replica and writes through lib/pages.ts, so a change shows at
 * once and syncs like any other edit. Expand/collapse and the highlight are view state only.
 */
import { useQuery } from "@powersync/react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";

import {
  ancestorIds,
  buildPageTree,
  createTarget,
  descendantIds,
  dropTarget,
  isFolder,
  type PageTree as Tree,
  type TreeRow,
} from "../../lib/page-tree";
import {
  AUTO_TITLE,
  createFolder,
  createPage,
  deletePages,
  movePage,
  renamePage,
} from "../../lib/pages";
import { ChevronIcon, FolderIcon, NewFolderIcon, NewPageIcon } from "./tree-icons";

/** One nesting level, in rem so it grows with the interface scale. */
const INDENT_REM = 0.75;

/**
 * The drag payload's type. Deliberately not text/plain: the editor and the title field accept
 * dropped text, so a row let go over the page would paste its id into the document.
 */
const DRAG_TYPE = "application/x-tendto-page";

/** `/p/<id>` → id. The tree highlights the open page without being told. */
function openPageIdFrom(pathname: string): string | null {
  const match = /^\/p\/([^/]+)/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null; // a malformed `%` in a typed URL must not take the sidebar down
  }
}

/** Drag state. `over` is where a drop would land: a folder id, or null for the top level. */
interface DragState {
  id: string;
  over: string | null | undefined;
}

/** Everything a row needs from the tree, passed down as one object. */
interface TreeContext {
  tree: Tree;
  selectedId: string | null;
  collapsed: ReadonlySet<string>;
  renamingId: string | null;
  /** The parent a new folder is being named in; undefined when none is. */
  draftParent: string | null | undefined;
  dropOver: string | null | undefined;
  draggingId: string | null;
  onToggle: (id: string) => void;
  onSelect: (row: TreeRow) => void;
  onStartRename: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onCancelRename: () => void;
  onCommitDraft: (name: string) => void;
  onCancelDraft: () => void;
  onAddPage: (parentId: string) => void;
  onDelete: (row: TreeRow) => void;
  onDragStart: (event: DragEvent, id: string) => void;
  onDragOver: (event: DragEvent, target: string | null) => void;
  onDrop: (event: DragEvent, target: string | null) => void;
  onDragEnd: () => void;
}

export function PageTree({ workspaceId }: { workspaceId: string | null }) {
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const openPageId = openPageIdFrom(pathname);

  const { data: rows } = useQuery<TreeRow>(
    "SELECT id, title, parent_id, kind, position FROM pages WHERE workspace_id = ?",
    [workspaceId ?? ""],
  );
  const tree = useMemo(() => buildPageTree(rows), [rows]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftParent, setDraftParent] = useState<string | null | undefined>(undefined);
  const [drag, setDrag] = useState<DragState | null>(null);

  // The open page is the highlighted row, like the active file in an editor, and its folders
  // open so the highlight can be seen. Only when the open page CHANGES: running again on every
  // tree change would undo a collapse made while the page stays open.
  useEffect(() => {
    if (!openPageId) return;
    setSelectedId(openPageId);
    const above = ancestorIds(tree, openPageId);
    if (above.length > 0) {
      setCollapsed((prev) => new Set([...prev].filter((id) => !above.includes(id))));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [openPageId]);

  /** Open these folders (and pages with subpages) so a new or moved row is visible. */
  function reveal(ids: readonly string[]): void {
    setCollapsed((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
  }

  function revealInside(parentId: string | null): void {
    if (parentId !== null) reveal([parentId, ...ancestorIds(tree, parentId)]);
  }

  async function handleNewPage(parentId: string | null): Promise<void> {
    if (!workspaceId) return;
    revealInside(parentId);
    const id = await createPage(workspaceId, parentId);
    setSelectedId(id);
    void navigate({ to: "/p/$pageId", params: { pageId: id } });
  }

  function handleStartFolder(): void {
    if (!workspaceId) return;
    const parentId = createTarget(tree, selectedId);
    revealInside(parentId);
    setRenamingId(null);
    setDraftParent(parentId);
  }

  async function handleCommitDraft(name: string): Promise<void> {
    const parentId = draftParent;
    setDraftParent(undefined);
    const trimmed = name.trim();
    if (!workspaceId || parentId === undefined || !trimmed) return;
    const id = await createFolder(workspaceId, parentId, trimmed);
    setSelectedId(id);
  }

  async function handleRename(id: string, name: string): Promise<void> {
    setRenamingId(null);
    const trimmed = name.trim();
    const row = tree.byId.get(id);
    if (!row || !trimmed || trimmed === row.title) return;
    await renamePage(id, trimmed);
  }

  async function handleDelete(row: TreeRow): Promise<void> {
    const message = isFolder(row)
      ? `Delete folder "${row.title || AUTO_TITLE}" and everything inside.`
      : `Delete "${row.title || AUTO_TITLE}" and any subpages?`;
    if (!window.confirm(message)) return;
    // What the tree shows inside the row, nothing more (see deletePages).
    await deletePages([row.id, ...descendantIds(tree, row.id)]);
    void navigate({ to: "/" });
  }

  function handleSelect(row: TreeRow): void {
    setSelectedId(row.id);
    if (isFolder(row)) {
      toggle(row.id);
      return;
    }
    void navigate({ to: "/p/$pageId", params: { pageId: row.id } });
  }

  function toggle(id: string): void {
    setCollapsed((prev) =>
      prev.has(id) ? new Set([...prev].filter((other) => other !== id)) : new Set([...prev, id]),
    );
  }

  /** A drop is refused onto the dragged row itself or anything inside it: that makes a loop. */
  function canDrop(dragId: string, target: string | null): boolean {
    if (target === null) return true;
    return target !== dragId && !descendantIds(tree, dragId).has(target);
  }

  function handleDragOver(event: DragEvent, target: string | null): void {
    // Rows stop the event even when refusing, so the empty-space handler below them does not
    // turn "not onto itself" into "out to the top level".
    event.stopPropagation();
    if (!drag || !canDrop(drag.id, target)) {
      if (drag && drag.over !== undefined) setDrag({ ...drag, over: undefined });
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (drag.over !== target) setDrag({ ...drag, over: target });
  }

  async function handleDrop(event: DragEvent, target: string | null): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const dragId = drag?.id ?? null;
    setDrag(null);
    if (dragId === null || !canDrop(dragId, target)) return;
    revealInside(target);
    await movePage(dragId, target);
  }

  const ctx: TreeContext = {
    tree,
    selectedId,
    collapsed,
    renamingId,
    draftParent,
    dropOver: drag?.over,
    draggingId: drag?.id ?? null,
    onToggle: toggle,
    onSelect: handleSelect,
    onStartRename: (id) => {
      setDraftParent(undefined);
      setRenamingId(id);
    },
    onRename: (id, name) => void handleRename(id, name),
    onCancelRename: () => setRenamingId(null),
    onCommitDraft: (name) => void handleCommitDraft(name),
    onCancelDraft: () => setDraftParent(undefined),
    onAddPage: (parentId) => void handleNewPage(parentId),
    onDelete: (row) => void handleDelete(row),
    onDragStart: (event, id) => {
      event.dataTransfer.setData(DRAG_TYPE, id);
      event.dataTransfer.effectAllowed = "move";
      setDrag({ id, over: undefined });
    },
    onDragOver: handleDragOver,
    onDrop: (event, target) => void handleDrop(event, target),
    onDragEnd: () => setDrag(null),
  };

  const roots = tree.children.get(null) ?? [];
  const rootDrop = drag !== null && drag.over === null;

  return (
    <section
      aria-label="Pages"
      onDragLeave={(event) => {
        // Leaving the tree altogether (onto the page, say): nothing would land, so nothing lit.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDrag((prev) => (prev && prev.over !== undefined ? { ...prev, over: undefined } : prev));
      }}
    >
      {/* The header is top level too: a drop here moves a row out, and a click on it (outside
          the buttons) clears the highlight, for when the empty space has scrolled away. */}
      <div
        className="flex items-center justify-between px-2 py-1"
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest("button")) setSelectedId(null);
        }}
        onDragOver={(event) => handleDragOver(event, null)}
        onDrop={(event) => void handleDrop(event, null)}
      >
        <span className="text-xs font-medium uppercase tracking-wide text-subtle">Pages</span>
        <div className="flex items-center gap-0.5">
          <HeaderButton
            label="New page"
            onClick={() => void handleNewPage(createTarget(tree, selectedId))}
          >
            <NewPageIcon />
          </HeaderButton>
          <HeaderButton label="New folder" onClick={handleStartFolder}>
            <NewFolderIcon />
          </HeaderButton>
        </div>
      </div>

      {/* The empty space below the rows is the top level: clicking it clears the highlight (so
          "New" lands at the top), and dropping on it moves a row out of its folder. */}
      <div
        data-testid="page-tree"
        className={`mb-4 min-h-10 rounded-md pb-6 ${rootDrop ? "bg-hover/40" : ""}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) setSelectedId(null);
        }}
        onDragOver={(event) => handleDragOver(event, null)}
        onDrop={(event) => void handleDrop(event, null)}
      >
        {draftParent === null ? <DraftFolderRow ctx={ctx} depth={0} /> : null}
        {roots.length === 0 && draftParent !== null ? (
          <p className="px-2 py-1.5 text-sm text-subtle">No pages yet</p>
        ) : (
          roots.map((row) => <TreeNode key={row.id} row={row} depth={0} ctx={ctx} />)
        )}
      </div>
    </section>
  );
}

function TreeNode({ row, depth, ctx }: { row: TreeRow; depth: number; ctx: TreeContext }) {
  const children = ctx.tree.children.get(row.id) ?? [];
  const folder = isFolder(row);
  const expandable = folder || children.length > 0;
  const expanded = !ctx.collapsed.has(row.id);
  const selected = ctx.selectedId === row.id;
  // A drop onto a page lands beside it, so the row that lights up is the folder it goes into.
  const dropHere = ctx.draggingId !== null && ctx.dropOver === row.id;
  const renaming = ctx.renamingId === row.id;
  const name = row.title || AUTO_TITLE;

  return (
    <div data-testid="tree-node" data-id={row.id}>
      <div
        draggable={!renaming}
        data-testid="tree-row"
        data-kind={folder ? "folder" : "page"}
        data-selected={selected ? "true" : undefined}
        onDragStart={(event) => ctx.onDragStart(event, row.id)}
        onDragOver={(event) => ctx.onDragOver(event, dropTarget(ctx.tree, row.id))}
        onDrop={(event) => ctx.onDrop(event, dropTarget(ctx.tree, row.id))}
        onDragEnd={ctx.onDragEnd}
        className={`group flex items-center gap-1 rounded-md pr-1 ${
          selected ? "bg-hover text-fg" : "text-muted hover:bg-hover/60"
        } ${dropHere ? "ring-1 ring-inset ring-muted" : ""} ${
          ctx.draggingId === row.id ? "opacity-50" : ""
        }`}
        style={{ paddingLeft: `${depth * INDENT_REM}rem` }}
      >
        {expandable ? (
          <button
            type="button"
            onClick={() => ctx.onToggle(row.id)}
            aria-label={expanded ? "Collapse" : "Expand"}
            aria-expanded={expanded}
            className="flex w-4 shrink-0 justify-center text-subtle"
          >
            <ChevronIcon open={expanded} className="h-3.5 w-3.5" />
          </button>
        ) : (
          <span className="w-4 shrink-0" aria-hidden />
        )}
        {folder ? <FolderIcon className="h-4 w-4 shrink-0 text-subtle" /> : null}

        {renaming ? (
          <NameInput
            initial={row.title}
            label="Folder name"
            onCommit={(value) => ctx.onRename(row.id, value)}
            onCancel={ctx.onCancelRename}
          />
        ) : (
          <button
            type="button"
            onClick={() => ctx.onSelect(row)}
            onDoubleClick={folder ? () => ctx.onStartRename(row.id) : undefined}
            title={folder ? "Double-click to rename" : undefined}
            className="flex-1 truncate py-1.5 text-left text-sm"
          >
            {name}
          </button>
        )}

        <button
          type="button"
          onClick={() => ctx.onAddPage(row.id)}
          aria-label={folder ? "Add page to folder" : "Add subpage"}
          title={folder ? "Add page to folder" : "Add subpage"}
          className="invisible shrink-0 rounded px-1 text-subtle hover:text-fg group-hover:visible"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => ctx.onDelete(row)}
          aria-label={folder ? "Delete folder" : "Delete page"}
          title={folder ? "Delete folder" : "Delete page"}
          className="invisible shrink-0 rounded px-1 text-subtle hover:text-danger group-hover:visible"
        >
          ×
        </button>
      </div>

      {expandable && expanded ? (
        <>
          {ctx.draftParent === row.id ? <DraftFolderRow ctx={ctx} depth={depth + 1} /> : null}
          {children.map((child) => (
            <TreeNode key={child.id} row={child} depth={depth + 1} ctx={ctx} />
          ))}
        </>
      ) : null}
    </div>
  );
}

/** The row a new folder is named in, before it exists. Empty name or Escape: nothing created. */
function DraftFolderRow({ ctx, depth }: { ctx: TreeContext; depth: number }) {
  return (
    <div className="flex items-center gap-1 pr-1" style={{ paddingLeft: `${depth * INDENT_REM}rem` }}>
      <span className="w-4 shrink-0" aria-hidden />
      <FolderIcon className="h-4 w-4 shrink-0 text-subtle" />
      <NameInput
        initial=""
        label="Folder name"
        onCommit={ctx.onCommitDraft}
        onCancel={ctx.onCancelDraft}
      />
    </div>
  );
}

/**
 * Inline name field. Enter or leaving the field commits; Escape cancels. Settles exactly once:
 * Enter unmounts the field, and the blur that unmounting fires must not commit a second time.
 */
function NameInput({
  initial,
  label,
  onCommit,
  onCancel,
}: {
  initial: string;
  label: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const settled = useRef(false);

  function settle(commit: boolean): void {
    if (settled.current) return;
    settled.current = true;
    if (commit) onCommit(value);
    else onCancel();
  }

  return (
    <input
      autoFocus
      value={value}
      aria-label={label}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          settle(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          settle(false);
        }
      }}
      onBlur={() => settle(true)}
      className="my-0.5 min-w-0 flex-1 rounded border border-line bg-app px-1.5 py-1 text-sm text-fg outline-none focus:border-muted"
    />
  );
}

function HeaderButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded p-0.5 text-subtle hover:bg-hover hover:text-fg"
    >
      {children}
    </button>
  );
}
