/**
 * Board (kanban) view: one column per status, cards grouped by `properties.status`.
 * Drag a card to another column to change its status (native HTML5 drag — no extra deps).
 */
import { useMemo, useState } from "react";

import {
  createItem,
  deleteItem,
  moveItemToStatus,
  parseProperties,
  patchItem,
  STATUS_LABELS,
  STATUSES,
  type ItemRow,
  type Status,
} from "../../../lib/items/mutations";
import { InlineText } from "./inline-text";

interface BoardViewProps {
  items: ItemRow[];
  workspaceId: string | null;
  collectionId: string;
}

export function BoardView({ items, workspaceId, collectionId }: BoardViewProps) {
  const byStatus = useMemo(() => {
    const map: Record<Status, ItemRow[]> = { todo: [], doing: [], done: [] };
    for (const row of items) map[parseProperties(row).status].push(row);
    return map;
  }, [items]);
  const itemsById = useMemo(() => new Map(items.map((row) => [row.id, row])), [items]);
  const [dragId, setDragId] = useState<string | null>(null);

  async function drop(status: Status): Promise<void> {
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const row = itemsById.get(id);
    if (row && parseProperties(row).status !== status) await moveItemToStatus(row, status);
  }

  return (
    <div className="flex h-full gap-4">
      {STATUSES.map((status) => (
        <div
          key={status}
          data-testid={`board-col-${status}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => void drop(status)}
          className="flex w-72 shrink-0 flex-col rounded-lg bg-neutral-50 p-2"
        >
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-sm font-medium text-neutral-700">{STATUS_LABELS[status]}</span>
            <span className="text-xs text-neutral-400">{byStatus[status].length}</span>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto">
            {byStatus[status].map((row) => (
              <BoardCard key={row.id} row={row} onDragStart={() => setDragId(row.id)} />
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              if (workspaceId) void createItem(workspaceId, collectionId, { status });
            }}
            className="mt-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-500 hover:bg-neutral-200/60"
          >
            + Add card
          </button>
        </div>
      ))}
    </div>
  );
}

function BoardCard({ row, onDragStart }: { row: ItemRow; onDragStart: () => void }) {
  const props = parseProperties(row);
  return (
    <div
      draggable
      onDragStart={onDragStart}
      data-testid="board-card"
      className="group cursor-grab rounded-md border border-neutral-200 bg-white p-2 shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <InlineText
          value={props.title}
          onCommit={(title) => void patchItem(row, { title })}
          placeholder="Untitled"
          className="flex-1 bg-transparent text-sm text-neutral-800 outline-none placeholder:text-neutral-300"
        />
        <button
          type="button"
          onClick={() => void deleteItem(row.id)}
          className="invisible shrink-0 text-neutral-300 hover:text-red-500 group-hover:visible"
          aria-label="Delete card"
        >
          ×
        </button>
      </div>
      {props.due ? <div className="mt-1 text-xs text-neutral-400">Due {props.due}</div> : null}
    </div>
  );
}
