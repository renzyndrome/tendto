/** List view: a compact read of each item — a column-colored status dot, title, assignees + due.
 *  Clicking a row opens the shared task detail modal (same item as every other view). */
import {
  columnColor,
  parseProperties,
  type Column,
  type ItemRow,
} from "../../../lib/items/mutations";
import type { WorkspaceMembers } from "../../../stores/members";
import { AssigneeAvatars, DueLabel } from "./item-meta";

interface ListViewProps {
  items: ItemRow[];
  columns: Column[];
  members: WorkspaceMembers;
  onOpenItem: (id: string) => void;
}

export function ListView({ items, columns, members, onOpenItem }: ListViewProps) {
  const indexById = new Map(columns.map((c, i) => [c.id, i]));

  if (items.length === 0) {
    return <p className="py-10 text-center text-sm text-muted">No items yet — add one above.</p>;
  }
  return (
    <ul className="divide-y divide-hairline">
      {items.map((row) => {
        const props = parseProperties(row);
        const index = indexById.get(props.status) ?? -1;
        return (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => onOpenItem(row.id)}
              className="flex w-full items-center gap-3 rounded-row px-2 py-2 text-left hover:bg-row-hover"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${columnColor(index)}`}
                title={columns[index]?.label ?? props.status}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-sm text-body">
                {props.title || "Untitled"}
              </span>
              <AssigneeAvatars assignees={props.assignees} members={members} size={20} />
              {props.due ? <DueLabel due={props.due} /> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
