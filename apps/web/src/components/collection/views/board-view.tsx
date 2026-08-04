/**
 * Board (kanban) view: one column per configured status. Columns are customizable per collection —
 * rename inline, reorder with ‹ ›, delete (cards move to the first column), and "+ Add column".
 * Drag a card between columns to change its status (native HTML5 drag driven by React state).
 */
import { useMemo, useState } from "react";

import { deleteColumn, newColumn, setColumns } from "../../../lib/collections";
import {
  columnColor,
  createItem,
  deleteItem,
  moveItemToStatus,
  parseProperties,
  patchItem,
  type Column,
  type ItemRow,
} from "../../../lib/items/mutations";
import { formatDueLabel } from "../../../lib/items/due";
import { AssigneePicker } from "./assignee-picker";
import { DuePicker } from "./due-picker";
import { InlineText } from "./inline-text";

interface BoardViewProps {
  items: ItemRow[];
  workspaceId: string | null;
  collectionId: string;
  columns: Column[];
}

export function BoardView({ items, workspaceId, collectionId, columns }: BoardViewProps) {
  const byStatus = useMemo(() => {
    const map = new Map<string, ItemRow[]>();
    for (const column of columns) map.set(column.id, []);
    const firstId = columns[0]?.id;
    for (const row of items) {
      const status = parseProperties(row).status;
      const list = map.get(status) ?? (firstId ? map.get(firstId) : undefined);
      list?.push(row); // items whose column was removed fall into the first column
    }
    return map;
  }, [items, columns]);

  const itemsById = useMemo(() => new Map(items.map((row) => [row.id, row])), [items]);
  const [dragId, setDragId] = useState<string | null>(null);

  async function drop(status: string): Promise<void> {
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const row = itemsById.get(id);
    if (row && parseProperties(row).status !== status) await moveItemToStatus(row, status);
  }

  function renameColumn(columnId: string, label: string): void {
    void setColumns(
      collectionId,
      columns.map((c) => (c.id === columnId ? { ...c, label } : c)),
    );
  }

  function moveColumn(index: number, dir: -1 | 1): void {
    const target = index + dir;
    if (target < 0 || target >= columns.length) return;
    const next = [...columns];
    [next[index], next[target]] = [next[target], next[index]];
    void setColumns(collectionId, next);
  }

  function removeColumn(columnId: string): void {
    if (columns.length <= 1) return;
    if (!window.confirm("Delete this column? Its cards move to the first column.")) return;
    void deleteColumn(collectionId, columns, columnId);
  }

  return (
    <div className="flex h-full items-start gap-4">
      {columns.map((column, index) => (
        <div
          key={column.id}
          data-testid={`board-col-${column.id}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => void drop(column.id)}
          className="flex w-72 shrink-0 flex-col rounded-lg bg-surface p-2"
        >
          <div className="group mb-2 flex items-center gap-1 px-1">
            <span className={`h-2 w-2 shrink-0 rounded-full ${columnColor(index)}`} aria-hidden />
            <InlineText
              value={column.label}
              onCommit={(label) => renameColumn(column.id, label)}
              placeholder="Column"
              className="min-w-0 flex-1 bg-transparent text-sm font-medium text-muted outline-none"
            />
            <span className="text-xs text-subtle">{byStatus.get(column.id)?.length ?? 0}</span>
            <button
              type="button"
              onClick={() => moveColumn(index, -1)}
              aria-label="Move column left"
              className="invisible px-0.5 text-subtle hover:text-fg group-hover:visible"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => moveColumn(index, 1)}
              aria-label="Move column right"
              className="invisible px-0.5 text-subtle hover:text-fg group-hover:visible"
            >
              ›
            </button>
            <button
              type="button"
              onClick={() => removeColumn(column.id)}
              aria-label="Delete column"
              className="invisible px-0.5 text-subtle hover:text-danger group-hover:visible"
            >
              ×
            </button>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto">
            {(byStatus.get(column.id) ?? []).map((row) => (
              <BoardCard
                key={row.id}
                row={row}
                workspaceId={workspaceId}
                onDragStart={() => setDragId(row.id)}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              if (workspaceId) void createItem(workspaceId, collectionId, { status: column.id });
            }}
            className="mt-2 rounded-md px-2 py-1.5 text-left text-sm text-muted hover:bg-hover"
          >
            + Add card
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => void setColumns(collectionId, [...columns, newColumn("New column")])}
        aria-label="Add column"
        className="mt-0 h-9 shrink-0 rounded-lg px-3 text-sm text-subtle hover:bg-hover hover:text-fg"
      >
        + Add column
      </button>
    </div>
  );
}

function BoardCard({
  row,
  workspaceId,
  onDragStart,
}: {
  row: ItemRow;
  workspaceId: string | null;
  onDragStart: () => void;
}) {
  const props = parseProperties(row);
  const [open, setOpen] = useState(false);
  return (
    <div
      draggable
      onDragStart={onDragStart}
      data-testid="board-card"
      className="group cursor-grab rounded-md border border-line bg-elevated p-2 shadow-sm"
    >
      <div className="flex items-start justify-between gap-1">
        <InlineText
          value={props.title}
          onCommit={(title) => void patchItem(row, { title })}
          placeholder="Untitled"
          multiline
          ariaLabel="Card title"
          className="min-w-0 flex-1 bg-transparent text-sm leading-snug text-fg outline-none placeholder:text-subtle"
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Hide card details" : "Edit card details"}
          className="shrink-0 text-subtle hover:text-fg"
        >
          {open ? "▴" : "▾"}
        </button>
        <button
          type="button"
          onClick={() => void deleteItem(row.id)}
          className="invisible shrink-0 text-subtle hover:text-danger group-hover:visible"
          aria-label="Delete card"
        >
          ×
        </button>
      </div>

      {/* Collapsed summary: what you'd want to see without opening the card. Chips wrap so a
          long assignee never pushes the due date out of sight. */}
      {!open && (props.due || props.assignee) ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {props.due ? (
            <span className="rounded bg-hover/50 px-1.5 py-0.5 text-[11px] text-muted">
              Due {formatDueLabel(props.due)}
            </span>
          ) : null}
          {typeof props.assignee === "string" && props.assignee ? (
            <span
              title={props.assignee}
              className="max-w-full truncate rounded bg-hover/50 px-1.5 py-0.5 text-[11px] text-muted"
            >
              {props.assignee}
            </span>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <div className="mt-2 space-y-1.5 border-t border-line pt-2">
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="w-14 shrink-0">Due</span>
            <DuePicker
              value={typeof props.due === "string" ? props.due : ""}
              onChange={(due) => void patchItem(row, { due })}
              idPrefix="card-due"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            <span className="w-14 shrink-0">Assignee</span>
            <AssigneePicker
              workspaceId={workspaceId}
              value={typeof props.assignee === "string" ? props.assignee : ""}
              onChange={(assignee) => void patchItem(row, { assignee })}
              ariaLabel="Card assignee"
              className="flex-1 rounded border border-line bg-elevated px-1.5 py-0.5 text-xs text-muted outline-none"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
