/**
 * One row of a sidebar tree, with its children, plus the inline name field. The tree's state
 * and actions live in sidebar-tree.tsx and arrive here as one `TreeContext`.
 */
import { useRef, useState } from "react";

import { isFolder, type TreeRow } from "../../lib/tree";
import { ChevronIcon, FolderIcon, StarIcon } from "./tree-icons";
import type { TreeContext } from "./tree-types";

/** One nesting level, in rem so it grows with the interface scale. */
export const INDENT_REM = 0.75;

/** Marks a row's main button, the element keyboard navigation moves focus to. */
export const MAIN_ATTR = "data-tree-main";

export function TreeNode({ row, depth, ctx }: { row: TreeRow; depth: number; ctx: TreeContext }) {
  const { source, drop } = ctx;
  const children = ctx.tree.children.get(row.id) ?? [];
  const folder = isFolder(row);
  const expandable = folder || children.length > 0;
  const expanded = !ctx.collapsed.has(row.id);
  const selected = ctx.selectedId === row.id;
  const dragging = ctx.draggingId !== null;
  const dropInto = dragging && drop?.intoId === row.id;
  const line = dragging && drop?.lineId === row.id ? drop.linePlace : undefined;
  const renaming = ctx.renamingId === row.id;
  const favorite = !folder && source.favoriteIds.has(row.id);
  const name = row.title || source.untitled;
  const addLabel = folder ? source.addToFolderLabel : source.addInsideItemLabel;
  const deleteLabel = folder ? "Delete folder" : source.deleteItemLabel;
  const favoriteLabel = favorite ? "Remove from favorites" : "Add to favorites";

  return (
    <div data-testid="tree-node" data-id={row.id}>
      <div
        draggable={!renaming}
        data-testid="tree-row"
        data-kind={folder ? "folder" : source.itemKind}
        data-selected={selected ? "true" : undefined}
        data-drop={dropInto ? "into" : line}
        onDragStart={(event) => ctx.onDragStart(event, row.id)}
        onDragOver={(event) => ctx.onRowDragOver(event, row)}
        onDrop={(event) => ctx.onRowDrop(event, row)}
        onDragEnd={ctx.onDragEnd}
        onContextMenu={(event) => ctx.onContextMenu(event, row)}
        className={`group relative flex items-center gap-1 rounded-md pr-1 ${
          selected ? "bg-hover text-fg" : "text-muted hover:bg-hover/60"
        } ${dropInto ? "ring-1 ring-inset ring-muted" : ""} ${
          ctx.draggingId === row.id ? "opacity-50" : ""
        }`}
        style={{ paddingLeft: `${depth * INDENT_REM}rem` }}
      >
        {/* Where a reorder lands: a line on the row's top or bottom edge. */}
        {line ? (
          <span
            aria-hidden
            className={`pointer-events-none absolute inset-x-1 h-0.5 rounded bg-fg/60 ${
              line === "before" ? "-top-px" : "-bottom-px"
            }`}
          />
        ) : null}
        {expandable ? (
          <button
            type="button"
            tabIndex={-1}
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
            maxLength={source.maxNameLength}
            onCommit={(value, byKey) => ctx.onRename(row.id, value, byKey)}
            onCancel={ctx.onCancelRename}
          />
        ) : (
          <button
            type="button"
            data-tree-main=""
            onClick={() => ctx.onSelect(row)}
            onDoubleClick={folder ? () => ctx.onStartRename(row.id) : undefined}
            title={folder ? "Double-click to rename" : undefined}
            aria-current={selected ? "true" : undefined}
            className="flex-1 truncate py-1.5 text-left text-sm"
          >
            {name}
          </button>
        )}

        {!folder ? (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => source.toggleFavorite(row)}
            aria-label={favoriteLabel}
            title={favoriteLabel}
            className="invisible shrink-0 rounded px-0.5 text-subtle hover:text-fg group-hover:visible"
          >
            <StarIcon filled={favorite} className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {addLabel ? (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => ctx.onAddInside(row.id)}
            aria-label={addLabel}
            title={addLabel}
            className="invisible shrink-0 rounded px-1 text-subtle hover:text-fg group-hover:visible"
          >
            +
          </button>
        ) : null}
        <button
          type="button"
          tabIndex={-1}
          onClick={() => ctx.onDelete(row)}
          aria-label={deleteLabel}
          title={deleteLabel}
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
export function DraftFolderRow({ ctx, depth }: { ctx: TreeContext; depth: number }) {
  return (
    <div
      className="flex items-center gap-1 pr-1"
      style={{ paddingLeft: `${depth * INDENT_REM}rem` }}
    >
      <span className="w-4 shrink-0" aria-hidden />
      <FolderIcon className="h-4 w-4 shrink-0 text-subtle" />
      <NameInput
        initial=""
        label="Folder name"
        maxLength={ctx.source.maxNameLength}
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
  maxLength,
  onCommit,
  onCancel,
}: {
  initial: string;
  label: string;
  maxLength?: number;
  onCommit: (value: string, byKey: boolean) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const settled = useRef(false);

  /** `byKey`: Enter or Escape, as opposed to focus leaving for somewhere else. */
  function settle(commit: boolean, byKey: boolean): void {
    if (settled.current) return;
    settled.current = true;
    if (commit) onCommit(value, byKey);
    else onCancel();
  }

  return (
    <input
      autoFocus
      value={value}
      aria-label={label}
      maxLength={maxLength}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        // The tree's own keys (arrows, Delete, F2) must not act while a name is being typed.
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          settle(true, true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          settle(false, true);
        }
      }}
      onBlur={() => settle(true, false)}
      className="my-0.5 min-w-0 flex-1 rounded border border-line bg-app px-1.5 py-1 text-sm text-fg outline-none focus:border-muted"
    />
  );
}
