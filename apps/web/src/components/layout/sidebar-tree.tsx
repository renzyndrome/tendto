/**
 * A sidebar section as a folder tree, worked like an editor's file explorer. Pages and
 * Collections both render through this; each passes a `TreeSource` that says what its rows are
 * and how to change them (page-tree.tsx, collection-tree.tsx).
 *
 * - Click a row to highlight it. The open page or collection is highlighted on its own.
 * - "New folder" / "New …" in the header create inside the highlighted folder, beside a
 *   highlighted item, or at the top level when nothing is highlighted (click empty space).
 * - A new folder is named in place; double-click (or F2) renames a folder.
 * - Drag a row onto a folder to move it in, onto a row's top or bottom edge to reorder, or onto
 *   the header or empty space to move it out.
 * - Right-click (or the ContextMenu key) for Open, Favorites, Rename, Move to… and Delete.
 * - Arrow keys walk the tree; Right and Left open and close; Delete deletes, with Undo.
 *
 * Everything reads from the local replica and writes through the source's lib functions, so a
 * change shows at once and syncs like any other edit. Expand/collapse and the highlight are
 * view state; which folders are closed is remembered per device.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import {
  ancestorIds,
  buildTree,
  createTarget,
  descendantIds,
  dropPlace,
  isFolder,
  reorderedSiblings,
  shownParent,
  visibleOrder,
  type TreeRow,
} from "../../lib/tree";
import { useHiddenIds, usePendingDelete } from "../../stores/pending-delete";
import { NewFolderIcon } from "./tree-icons";
import { TreeMenu } from "./tree-menu";
import { DraftFolderRow, MAIN_ATTR, TreeNode } from "./tree-row";
import type { DropHint, TreeContext, TreeSource } from "./tree-types";

export type { TreeSource } from "./tree-types";

/** `/<prefix>/<id>…` → id, for `openId`. Tolerates a malformed `%` in a typed URL. */
export function idFromPath(pathname: string, prefix: string): string | null {
  const match = new RegExp(`^/${prefix}/([^/]+)`).exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null; // a malformed `%` must not take the sidebar down
  }
}

/** Where a section remembers its closed folders on this device. */
const collapsedKey = (testId: string) => `tendto:tree-collapsed:${testId}`;

function readCollapsed(testId: string): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(collapsedKey(testId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set(); // storage blocked or the value is nonsense: everything starts open
  }
}

function writeCollapsed(testId: string, ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(collapsedKey(testId), JSON.stringify([...ids]));
  } catch {
    // Storage unavailable: the folders still open and close, they just are not remembered.
  }
}

/** Drag state: what is being dragged, and where it would land right now. */
interface DragState {
  id: string;
  over: DropHint | undefined;
}

interface MenuState {
  rowId: string;
  x: number;
  y: number;
}

export function SidebarTree({ source }: { source: TreeSource }) {
  const { openId } = source;
  const hidden = useHiddenIds();
  const schedule = usePendingDelete((state) => state.schedule);
  // Rows waiting on Undo are gone from view; the tree is built without them.
  const rows = useMemo(
    () => (hidden.size === 0 ? source.rows : source.rows.filter((row) => !hidden.has(row.id))),
    [source.rows, hidden],
  );
  const tree = useMemo(() => buildTree(rows), [rows]);
  const bodyRef = useRef<HTMLDivElement>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() =>
    readCollapsed(source.testId),
  );
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftParent, setDraftParent] = useState<string | null | undefined>(undefined);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => writeCollapsed(source.testId, collapsed), [source.testId, collapsed]);

  // The open row is the highlighted one, like the active file in an editor, and its folders
  // open so the highlight can be seen. Only when the open row CHANGES: running again on every
  // tree change would undo a collapse made while it stays open. Leaving this section (a page
  // opened while a collection was) clears it, so "New …" here does not land in a folder from
  // what was open before.
  // Its folders open once per visit to a row, as soon as the tree holds it: after a reload or a
  // deep link the rows arrive after the route does, and a remembered closed folder must not hide
  // the page that is open. Once per visit, so a collapse made while it stays open is respected.
  const revealedFor = useRef<string | null>(null);
  useEffect(() => {
    setSelectedId(openId);
    revealedFor.current = null; // a new visit, even back to the same row
  }, [openId]);

  useEffect(() => {
    if (!openId || revealedFor.current === openId || !tree.byId.has(openId)) return;
    revealedFor.current = openId;
    const above = ancestorIds(tree, openId);
    if (above.length > 0) {
      setCollapsed((prev) => new Set([...prev].filter((id) => !above.includes(id))));
    }
  }, [openId, tree]);

  /** Open these folders (and items holding items) so a new or moved row is visible. */
  function reveal(ids: readonly string[]): void {
    setCollapsed((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
  }

  function revealInside(parentId: string | null): void {
    if (parentId !== null) reveal([parentId, ...ancestorIds(tree, parentId)]);
  }

  /**
   * Move keyboard focus to a row's main button. At once when the row is already drawn, so the
   * next key press acts on it; a frame later when it is not yet (a folder just opened, a rename
   * field just closed).
   */
  function focusRow(id: string): void {
    const find = () =>
      bodyRef.current?.querySelector<HTMLElement>(
        `[data-id="${CSS.escape(id)}"] > [data-testid="tree-row"] [${MAIN_ATTR}]`,
      );
    const now = find();
    if (now) {
      now.focus();
      return;
    }
    requestAnimationFrame(() => find()?.focus());
  }

  async function handleNewItem(parentId: string | null): Promise<void> {
    if (!source.enabled) return;
    revealInside(parentId);
    const id = await source.createItem(parentId);
    setSelectedId(id);
    source.open(id);
  }

  function handleStartFolder(parentId: string | null): void {
    if (!source.enabled) return;
    revealInside(parentId);
    setRenamingId(null);
    setDraftParent(parentId);
  }

  async function handleCommitDraft(name: string, byKey: boolean): Promise<void> {
    const parentId = draftParent;
    setDraftParent(undefined);
    const trimmed = name.trim();
    if (!source.enabled || parentId === undefined || !trimmed) return;
    const id = await source.createFolder(parentId, trimmed);
    setSelectedId(id);
    if (byKey) focusRow(id);
  }

  function handleStartRename(id: string): void {
    setDraftParent(undefined);
    setRenamingId(id);
  }

  async function handleRename(id: string, name: string, byKey: boolean): Promise<void> {
    setRenamingId(null);
    // Only after Enter: a rename committed by clicking elsewhere leaves focus where it went.
    if (byKey) focusRow(id);
    const trimmed = name.trim();
    const row = tree.byId.get(id);
    if (!row || !trimmed || trimmed === row.title) return;
    await source.rename(id, trimmed);
  }

  /**
   * Delete with Undo instead of a confirm: the rows vanish now and the delete is written only
   * once the Undo window closes (stores/pending-delete.ts). What goes is exactly what the tree
   * shows inside the row (see deletePages in lib/pages.ts).
   */
  function handleDelete(row: TreeRow): void {
    const ids = [row.id, ...descendantIds(tree, row.id)];
    const wasOpen = openId !== null && ids.includes(openId);
    const name = row.title || source.untitled;
    schedule({
      label: isFolder(row) ? `Folder "${name}" deleted.` : `"${name}" deleted.`,
      ids,
      commit: () => source.remove(ids),
      restore: wasOpen && openId ? () => source.open(openId) : undefined,
    });
    if (wasOpen) source.afterDelete();
  }

  /**
   * Delete from the keyboard (Delete, or Delete in the menu) and keep focus in the tree: on the
   * next row the tree still shows after the deleted branch, else the one before it, else the
   * tree body itself.
   */
  function deleteAndFocusNext(row: TreeRow): void {
    const order = visibleOrder(tree, collapsed);
    const gone = new Set([row.id, ...descendantIds(tree, row.id)]);
    const at = order.indexOf(row.id);
    const next =
      order.slice(at + 1).find((id) => !gone.has(id)) ??
      order
        .slice(0, Math.max(at, 0))
        .reverse()
        .find((id) => !gone.has(id));
    handleDelete(row);
    if (next) {
      setSelectedId(next);
      focusRow(next);
    } else {
      bodyRef.current?.focus();
    }
  }

  function handleSelect(row: TreeRow): void {
    setSelectedId(row.id);
    if (isFolder(row)) {
      toggle(row.id);
      return;
    }
    source.open(row.id);
  }

  function toggle(id: string): void {
    setCollapsed((prev) =>
      prev.has(id) ? new Set([...prev].filter((other) => other !== id)) : new Set([...prev, id]),
    );
  }

  async function handleMoveTo(id: string, parentId: string | null): Promise<void> {
    revealInside(parentId);
    await source.move(id, parentId);
    setSelectedId(id);
  }

  // --- drag and drop ----------------------------------------------------------------------

  /** A drop is refused into the dragged row itself or anything inside it: that makes a loop. */
  function canJoin(dragId: string, parentId: string | null): boolean {
    if (parentId === null) return true;
    return parentId !== dragId && !descendantIds(tree, dragId).has(parentId);
  }

  function setOver(next: DropHint | undefined): void {
    setDrag((prev) => {
      if (!prev) return prev;
      const same =
        prev.over?.parentId === next?.parentId &&
        prev.over?.intoId === next?.intoId &&
        prev.over?.lineId === next?.lineId &&
        prev.over?.linePlace === next?.linePlace;
      return same ? prev : { ...prev, over: next };
    });
  }

  /** Where a drop on this row would land, or undefined when it would be refused. */
  function hintForRow(event: DragEvent, row: TreeRow, dragId: string): DropHint | undefined {
    if (row.id === dragId) return undefined;
    const box = event.currentTarget.getBoundingClientRect();
    const place = dropPlace(row, box.height > 0 ? (event.clientY - box.top) / box.height : 0.5);
    if (place === "into") {
      return canJoin(dragId, row.id) ? { parentId: row.id, intoId: row.id } : undefined;
    }
    const parentId = shownParent(tree, row.id);
    if (!canJoin(dragId, parentId)) return undefined;
    const order = reorderedSiblings(tree, dragId, row.id, place);
    if (order) return { parentId, lineId: row.id, linePlace: place, order };
    // A folder beside an item (or the reverse) does not reorder: it joins the parent.
    return { parentId, intoId: parentId ?? undefined };
  }

  function handleRowDragOver(event: DragEvent, row: TreeRow): void {
    // Rows stop the event even when refusing, so the empty-space handler below them does not
    // turn "not onto itself" into "out to the top level".
    event.stopPropagation();
    const hint = drag ? hintForRow(event, row, drag.id) : undefined;
    setOver(hint);
    if (!hint) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function handleRootDragOver(event: DragEvent): void {
    event.stopPropagation();
    if (!drag) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setOver({ parentId: null });
  }

  async function land(hint: DropHint | undefined): Promise<void> {
    const dragId = drag?.id ?? null;
    setDrag(null);
    if (dragId === null || !hint || !canJoin(dragId, hint.parentId)) return;
    revealInside(hint.parentId);
    if (hint.order) await source.place(dragId, hint.parentId, hint.order);
    else await source.move(dragId, hint.parentId);
  }

  function handleRowDrop(event: DragEvent, row: TreeRow): void {
    event.preventDefault();
    event.stopPropagation();
    void land(drag ? hintForRow(event, row, drag.id) : undefined);
  }

  function handleRootDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    void land({ parentId: null });
  }

  // --- keyboard ---------------------------------------------------------------------------

  /** VS Code's explorer keys, on whichever row has focus. */
  function handleKeyDown(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || menu) return;
    const focused = (event.target as HTMLElement).closest("[data-id]")?.getAttribute("data-id");
    const currentId = focused ?? selectedId;
    const order = visibleOrder(tree, collapsed);
    if (order.length === 0) return;
    const at = currentId ? order.indexOf(currentId) : -1;
    const row = currentId ? tree.byId.get(currentId) : undefined;

    const go = (id: string | undefined): void => {
      if (!id) return;
      setSelectedId(id);
      focusRow(id);
    };

    switch (event.key) {
      case "ArrowDown":
        go(order[Math.min(at + 1, order.length - 1)]);
        break;
      case "ArrowUp":
        go(order[Math.max(at - 1, 0)]);
        break;
      case "Home":
        go(order[0]);
        break;
      case "End":
        go(order[order.length - 1]);
        break;
      case "ArrowRight": {
        if (!row) return;
        const kids = tree.children.get(row.id) ?? [];
        if ((isFolder(row) || kids.length > 0) && collapsed.has(row.id)) toggle(row.id);
        else if (kids[0]) go(kids[0].id);
        break;
      }
      case "ArrowLeft": {
        if (!row) return;
        const hasKids = (tree.children.get(row.id) ?? []).length > 0;
        if ((isFolder(row) || hasKids) && !collapsed.has(row.id)) toggle(row.id);
        else go(shownParent(tree, row.id) ?? undefined);
        break;
      }
      case "F2":
        if (row && isFolder(row)) handleStartRename(row.id);
        else return;
        break;
      case "Delete":
        if (!row) return;
        deleteAndFocusNext(row);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  // --- context menu -----------------------------------------------------------------------

  function handleContextMenu(event: MouseEvent, row: TreeRow): void {
    event.preventDefault();
    setSelectedId(row.id);
    // The ContextMenu key reports (0, 0); open beside the row instead.
    const box = event.currentTarget.getBoundingClientRect();
    const fromKeyboard = event.clientX === 0 && event.clientY === 0;
    setMenu({
      rowId: row.id,
      x: fromKeyboard ? box.left + 24 : event.clientX,
      y: fromKeyboard ? box.bottom : event.clientY,
    });
  }

  function closeMenu(refocus: boolean): void {
    if (menu && refocus) focusRow(menu.rowId);
    setMenu(null);
  }

  // A row can vanish under its open menu (a teammate deleted it, a sync moved it away): close
  // the menu rather than leave the tree's keys switched off behind an invisible one.
  useEffect(() => {
    if (menu && !tree.byId.has(menu.rowId)) setMenu(null);
  }, [menu, tree]);

  const ctx: TreeContext = {
    source,
    tree,
    selectedId,
    collapsed,
    renamingId,
    draftParent,
    drop: drag?.over,
    draggingId: drag?.id ?? null,
    onToggle: toggle,
    onSelect: handleSelect,
    onStartRename: handleStartRename,
    onRename: (id, name, byKey) => void handleRename(id, name, byKey),
    onCancelRename: () => {
      if (renamingId) focusRow(renamingId);
      setRenamingId(null);
    },
    onCommitDraft: (name, byKey) => void handleCommitDraft(name, byKey),
    onCancelDraft: () => setDraftParent(undefined),
    onAddInside: (parentId) => void handleNewItem(parentId),
    onDelete: handleDelete,
    onContextMenu: handleContextMenu,
    onDragStart: (event, id) => {
      event.dataTransfer.setData(source.dragType, id);
      event.dataTransfer.effectAllowed = "move";
      setMenu(null);
      setDrag({ id, over: undefined });
    },
    onRowDragOver: handleRowDragOver,
    onRowDrop: handleRowDrop,
    onDragEnd: () => setDrag(null),
  };

  const roots = tree.children.get(null) ?? [];
  const rootDrop = drag !== null && drag.over?.parentId === null && !drag.over.lineId;
  const menuRow = menu ? tree.byId.get(menu.rowId) : undefined;

  return (
    <section
      aria-label={source.heading}
      onDragLeave={(event) => {
        // Leaving the tree altogether (onto the page, say): nothing would land, so nothing lit.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setOver(undefined);
      }}
    >
      {/* The header is top level too: a drop here moves a row out, and a click on it (outside
          the buttons) clears the highlight, for when the empty space has scrolled away. */}
      <div
        className="flex items-center justify-between px-2 py-1"
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest("button")) setSelectedId(null);
        }}
        onDragOver={handleRootDragOver}
        onDrop={handleRootDrop}
      >
        <span className="text-xs font-medium uppercase tracking-wide text-subtle">
          {source.heading}
        </span>
        <div className="flex items-center gap-0.5">
          <HeaderButton
            label="New folder"
            onClick={() => handleStartFolder(createTarget(tree, selectedId))}
          >
            <NewFolderIcon />
          </HeaderButton>
          <HeaderButton
            label={source.newItemLabel}
            onClick={() => void handleNewItem(createTarget(tree, selectedId))}
          >
            {source.newItemIcon}
          </HeaderButton>
        </div>
      </div>

      {/* The empty space below the rows is the top level: clicking it clears the highlight (so
          "New" lands at the top), and dropping on it moves a row out of its folder. */}
      <div
        ref={bodyRef}
        // Focusable only from code: the place focus lands when the last row is deleted.
        tabIndex={-1}
        data-testid={source.testId}
        className={`mb-4 min-h-10 rounded-md pb-6 ${rootDrop ? "bg-hover/40" : ""}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) setSelectedId(null);
        }}
        onKeyDown={handleKeyDown}
        onDragOver={handleRootDragOver}
        onDrop={handleRootDrop}
      >
        {draftParent === null ? <DraftFolderRow ctx={ctx} depth={0} /> : null}
        {roots.length === 0 && draftParent !== null ? (
          <p className="px-2 py-1.5 text-sm text-subtle">{source.emptyText}</p>
        ) : (
          roots.map((row) => <TreeNode key={row.id} row={row} depth={0} ctx={ctx} />)
        )}
      </div>

      {menu && menuRow ? (
        <TreeMenu
          row={menuRow}
          tree={tree}
          source={source}
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          actions={{
            open: (row) => handleSelect(row),
            addInside: (parentId) => void handleNewItem(parentId),
            rename: handleStartRename,
            move: (id, parentId) => void handleMoveTo(id, parentId),
            remove: deleteAndFocusNext,
          }}
        />
      ) : null}
    </section>
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
