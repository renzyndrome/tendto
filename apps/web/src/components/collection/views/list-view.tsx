/** List view: a compact read of each item — status dot, title, optional assignee + due. */
import {
  parseProperties,
  STATUS_COLORS,
  STATUS_LABELS,
  type ItemRow,
} from "../../../lib/items/mutations";

export function ListView({ items }: { items: ItemRow[] }) {
  if (items.length === 0) {
    return <p className="py-10 text-center text-sm text-neutral-400">No items yet — add one above.</p>;
  }
  return (
    <ul className="divide-y divide-neutral-100">
      {items.map((row) => {
        const props = parseProperties(row);
        return (
          <li key={row.id} className="flex items-center gap-3 px-2 py-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${STATUS_COLORS[props.status]}`}
              title={STATUS_LABELS[props.status]}
              aria-hidden
            />
            <span className="flex-1 truncate text-sm text-neutral-800">
              {props.title || "Untitled"}
            </span>
            {props.assignee ? <span className="text-xs text-neutral-400">{props.assignee}</span> : null}
            {props.due ? <span className="text-xs text-neutral-400">{props.due}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
