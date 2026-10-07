/**
 * The right-click menu on a sidebar tree row (also the ContextMenu key and Shift+F10, which
 * fire the same event). "Move to…" swaps the menu for a list of folders, so a row can be filed
 * without dragging: on a phone, or in a tree too long to drag across.
 *
 * Hand-rolled like every popover here: fixed at the pointer, kept inside the window, closed by
 * Escape, by a click anywhere else, or by the window losing focus.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import { descendantIds, isFolder, shownParent, type Tree, type TreeRow } from "../../lib/tree";
import type { TreeSource } from "./tree-types";

export interface TreeMenuActions {
  open: (row: TreeRow) => void;
  addInside: (parentId: string) => void;
  rename: (id: string) => void;
  move: (id: string, parentId: string | null) => void;
  remove: (row: TreeRow) => void;
}

interface TreeMenuProps {
  row: TreeRow;
  tree: Tree;
  source: TreeSource;
  x: number;
  y: number;
  actions: TreeMenuActions;
  /** `refocus`: give focus back to the row (Escape), rather than leave it where it went. */
  onClose: (refocus: boolean) => void;
}

/** Every folder a row may move into: all of them but itself and its own subfolders. */
function moveTargets(tree: Tree, row: TreeRow): { id: string; title: string; depth: number }[] {
  const blocked = new Set([row.id, ...descendantIds(tree, row.id)]);
  const out: { id: string; title: string; depth: number }[] = [];
  const walk = (parent: string | null, depth: number): void => {
    for (const child of tree.children.get(parent) ?? []) {
      if (!isFolder(child) || blocked.has(child.id)) continue;
      out.push({ id: child.id, title: child.title, depth });
      walk(child.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function TreeMenu({ row, tree, source, x, y, actions, onClose }: TreeMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"main" | "move">("main");
  const [position, setPosition] = useState({ left: x, top: y });
  const folder = isFolder(row);
  const favorite = !folder && source.favoriteIds.has(row.id);
  const currentParent = shownParent(tree, row.id);

  // Keep the menu inside the window, measured after it renders (its height depends on mode).
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPosition({
      left: Math.max(4, Math.min(x, window.innerWidth - box.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - box.height - 4)),
    });
  }, [x, y, mode]);

  // Focus the first item so the menu works from the keyboard; the menu itself when every item
  // is disabled (nowhere to move to), so Escape still reaches it.
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not([disabled])");
    (first ?? ref.current)?.focus();
  }, [mode]);

  useEffect(() => {
    // A click elsewhere is going somewhere: close without pulling focus back to the row.
    const dismiss = () => onClose(false);
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) dismiss();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
    };
  }, [onClose]);

  function onKeyDown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onClose(true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not([disabled])") ??
        []),
    ];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? at + 1 : at - 1;
    items[(next + items.length) % items.length]?.focus();
  }

  /** Close, then run a choice. Focus is the action's to place (a rename field takes it). */
  const run = (action: () => void) => () => {
    onClose(false);
    action();
  };

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="menu"
      aria-label={mode === "move" ? "Move to" : `${row.title || source.untitled} actions`}
      data-testid="tree-menu"
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      style={{ left: position.left, top: position.top }}
      className="fixed z-50 max-h-[60vh] min-w-[12rem] max-w-[18rem] overflow-y-auto rounded-lg border border-line bg-elevated py-1 text-sm text-fg shadow-xl"
    >
      {mode === "main" ? (
        <>
          {folder ? null : <Item label="Open" onClick={run(() => actions.open(row))} />}
          {folder ? (
            <Item label={source.addToFolderLabel} onClick={run(() => actions.addInside(row.id))} />
          ) : (
            <Item
              label={favorite ? "Remove from favorites" : "Add to favorites"}
              onClick={run(() => source.toggleFavorite(row))}
            />
          )}
          {folder ? <Item label="Rename" onClick={run(() => actions.rename(row.id))} /> : null}
          <Item label="Move to…" onClick={() => setMode("move")} />
          <div className="my-1 border-t border-line" />
          <Item label="Delete" danger onClick={run(() => actions.remove(row))} />
        </>
      ) : (
        <>
          <Item
            label="Top level"
            disabled={currentParent === null}
            onClick={run(() => actions.move(row.id, null))}
          />
          {moveTargets(tree, row).map((target) => (
            <Item
              key={target.id}
              label={target.title || source.untitled}
              indent={target.depth + 1}
              disabled={currentParent === target.id}
              onClick={run(() => actions.move(row.id, target.id))}
            />
          ))}
        </>
      )}
    </div>
  );
}

function Item({
  label,
  onClick,
  disabled = false,
  danger = false,
  indent = 0,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  indent?: number;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      style={{ paddingLeft: `${0.75 + indent * 0.75}rem` }}
      className={`block w-full truncate py-1.5 pr-3 text-left outline-none hover:bg-hover focus:bg-hover disabled:cursor-default disabled:text-subtle disabled:hover:bg-transparent ${
        danger ? "text-danger" : ""
      }`}
    >
      {label}
    </button>
  );
}
