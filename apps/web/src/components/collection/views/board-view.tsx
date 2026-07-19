/**
 * Board (kanban) view: one column per configured status. Columns are customizable per collection —
 * rename inline, reorder with ‹ ›, delete (cards move to the first column), and "+ Add column".
 * Drag a card between columns to change its status (native HTML5 drag driven by React state).
 */
import { useMemo, useState } from "react";

import { deleteColumn, newColumn, setColumns } from "../../../lib/collections";
import {
  createItem,
  deleteItem,
  moveItemToStatus,
  parseProperties,
  type Column,
  type ItemRow,
} from "../../../lib/items/mutations";
import type { WorkspaceMembers } from "../../../stores/members";
import { Icon } from "../../ui/icon";
import { InlineText } from "./inline-text";
import { AssigneeAvatars, DueLabel } from "./item-meta";

interface BoardViewProps {
  items: ItemRow[];
  workspaceId: string | null;
  collectionId: string;
  columns: Column[];
  members: WorkspaceMembers;
  onOpenItem: (id: string) => void;
}

export function BoardView({
  items,
  workspaceId,
  collectionId,
  columns,
  members,
  onOpenItem,
}: BoardViewProps) {
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
  const [overCol, setOverCol] = useState<string | null>(null);

  async function drop(status: string): Promise<void> {
    const id = dragId;
    setDragId(null);
    setOverCol(null);
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

  function addCard(status: string): void {
    if (workspaceId) void createItem(workspaceId, collectionId, { status });
  }

  return (
    <div className="flex h-full items-start gap-4 overflow-x-auto">
      {columns.map((column, index) => {
        const isDone = index === columns.length - 1 && columns.length > 1;
        const cards = byStatus.get(column.id) ?? [];
        return (
          <div
            key={column.id}
            data-testid={`board-col-${column.id}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOverCol(column.id);
            }}
            onDrop={() => void drop(column.id)}
            className="flex w-[236px] shrink-0 flex-col gap-2.5"
          >
            <div className="group flex items-center gap-1.5 px-0.5">
              <InlineText
                value={column.label}
                onCommit={(label) => renameColumn(column.id, label)}
                placeholder="Column"
                className={
                  "min-w-0 flex-1 bg-transparent text-xs font-semibold outline-none placeholder:text-faint " +
                  (isDone ? "text-faint" : "text-secondary")
                }
              />
              <span className="shrink-0 rounded-pill bg-chip px-1.5 text-[10.5px] text-faint">
                {cards.length}
              </span>
              <button
                type="button"
                onClick={() => moveColumn(index, -1)}
                aria-label="Move column left"
                className="invisible shrink-0 rounded p-0.5 text-faint hover:text-ink group-hover:visible"
              >
                <Icon name="chevron-left" size={13} />
              </button>
              <button
                type="button"
                onClick={() => moveColumn(index, 1)}
                aria-label="Move column right"
                className="invisible shrink-0 rounded p-0.5 text-faint hover:text-ink group-hover:visible"
              >
                <Icon name="chevron-right" size={13} />
              </button>
              <button
                type="button"
                onClick={() => removeColumn(column.id)}
                aria-label="Delete column"
                className="invisible shrink-0 rounded p-0.5 text-faint hover:text-overdue group-hover:visible"
              >
                <Icon name="close" size={13} />
              </button>
              <button
                type="button"
                onClick={() => addCard(column.id)}
                aria-label="Add card"
                className="invisible shrink-0 rounded p-0.5 text-faint hover:text-ink group-hover:visible"
              >
                <Icon name="plus" size={13} />
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto">
              {cards.map((row) => (
                <BoardCard
                  key={row.id}
                  row={row}
                  done={isDone}
                  dragging={dragId === row.id}
                  members={members}
                  onOpen={() => onOpenItem(row.id)}
                  onDragStart={() => setDragId(row.id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverCol(null);
                  }}
                />
              ))}
              {overCol === column.id && dragId ? (
                <div
                  className="h-16 rounded-card border-[1.5px] border-dashed"
                  style={{ borderColor: "var(--accent-dashed)", background: "var(--accent-fill-6)" }}
                />
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => addCard(column.id)}
              className="rounded-row px-2 py-1.5 text-left text-[12px] text-faint hover:text-ink"
            >
              + Add card
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => void setColumns(collectionId, [...columns, newColumn()])}
        aria-label="Add column"
        className="mt-0 h-9 shrink-0 rounded-card px-3 text-[12px] text-faint hover:bg-btn-hover hover:text-ink"
      >
        + Add column
      </button>
    </div>
  );
}

interface BoardCardProps {
  row: ItemRow;
  done: boolean;
  dragging: boolean;
  members: WorkspaceMembers;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

/**
 * A board card = a compact SUMMARY of the item (title, tag, due, assignees). Clicking it opens the
 * task detail modal for full editing — keeping the card itself uncluttered (fixes the old cramped
 * inline panel). Dragging still moves it between columns; the ✕ deletes.
 */
function BoardCard({ row, done, dragging, members, onOpen, onDragStart, onDragEnd }: BoardCardProps) {
  const props = parseProperties(row);
  const tag = typeof props.tag === "string" && props.tag ? props.tag : null;
  const hasMeta = tag || props.due || (props.assignees && props.assignees.length > 0);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      data-testid="board-card"
      className={
        "group rounded-card border px-3.5 py-3 " +
        (dragging
          ? "rotate-[2.5deg] cursor-grabbing border-accent bg-surface shadow-drag"
          : done
            ? "cursor-pointer border-hairline bg-canvas"
            : "cursor-pointer border-border-soft bg-surface shadow-card hover:border-border-hover")
      }
    >
      <div className="flex items-start justify-between gap-1.5">
        <span
          className={
            "min-w-0 flex-1 text-[13px] leading-[1.4] " +
            (done ? "text-muted line-through" : "font-medium text-body")
          }
        >
          {props.title || <span className="text-muted">Untitled</span>}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void deleteItem(row.id);
          }}
          className="invisible shrink-0 rounded text-faint hover:text-overdue group-hover:visible"
          aria-label="Delete card"
        >
          <Icon name="close" size={13} />
        </button>
      </div>

      {!done && hasMeta ? (
        <div className="mt-2 flex items-center gap-2">
          {tag ? (
            <span className="rounded-pill bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent-soft-text">
              {tag}
            </span>
          ) : null}
          {props.due ? <DueLabel due={props.due} /> : null}
          <div className="ml-auto">
            <AssigneeAvatars assignees={props.assignees} members={members} size={20} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
