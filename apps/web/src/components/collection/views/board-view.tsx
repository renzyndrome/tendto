/**
 * Board (kanban) view: one column per configured status. Columns are customizable per collection —
 * rename inline, reorder with ‹ ›, delete (cards move to the first column), and "+ Add column".
 * Drag a card between columns to change its status (native HTML5 drag driven by React state).
 */
import { useMemo, useState } from "react";

import { deleteColumn, newColumn, setColumns } from "../../../lib/collections";
import {
  columnColor,
  deleteItem,
  moveItemToStatus,
  parseProperties,
  type Column,
  type ItemRow,
} from "../../../lib/items/mutations";
import { formatDueLabel } from "../../../lib/items/due";
import { InlineText } from "./inline-text";

interface BoardViewProps {
  items: ItemRow[];
  collectionId: string;
  columns: Column[];
  /** Open a card's detail dialog (a route change — see CollectionView). */
  onOpen: (itemId: string) => void;
  /** Create a card in this column and open it, so quick capture stays one flow. */
  onAdd: (status: string) => void;
}

export function BoardView({ items, collectionId, columns, onOpen, onAdd }: BoardViewProps) {
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
                onOpen={() => onOpen(row.id)}
                onDragStart={() => setDragId(row.id)}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => onAdd(column.id)}
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

/**
 * A card is a summary, not a form. Clicking it opens the detail dialog (Trello-style), which is
 * where every field is edited — a 18rem card is the wrong place for a description, a status
 * select and two date inputs. Chips show what you'd want at a glance without opening it.
 */
function BoardCard({
  row,
  onOpen,
  onDragStart,
}: {
  row: ItemRow;
  onOpen: () => void;
  onDragStart: () => void;
}) {
  const props = parseProperties(row);
  return (
    <div
      draggable
      onDragStart={onDragStart}
      data-testid="board-card"
      className="group relative rounded-md border border-line bg-elevated shadow-sm"
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${props.title || "Untitled"}`}
        className="w-full cursor-pointer p-2 pr-6 text-left"
      >
        <span className="block text-sm leading-snug text-fg">
          {props.title || <span className="text-subtle">Untitled</span>}
        </span>

        {props.due || props.assignee ? (
          <span className="mt-1.5 flex flex-wrap items-center gap-1">
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
          </span>
        ) : null}
      </button>

      <button
        type="button"
        onClick={() => void deleteItem(row.id)}
        className="invisible absolute right-1 top-1 rounded px-1 text-subtle hover:text-danger group-hover:visible"
        aria-label="Delete card"
      >
        ×
      </button>
    </div>
  );
}
