/** Checklist view: a checkbox (checked = status "done") + inline-editable title per item. */
import { deleteItem, parseProperties, patchItem, type ItemRow } from "../../../lib/items/mutations";
import { InlineText } from "./inline-text";

export function ChecklistView({ items }: { items: ItemRow[] }) {
  if (items.length === 0) {
    return <p className="py-10 text-center text-sm text-neutral-400">No items yet — add one above.</p>;
  }
  return (
    <ul data-testid="checklist" className="space-y-0.5">
      {items.map((row) => (
        <ChecklistRow key={row.id} row={row} />
      ))}
    </ul>
  );
}

function ChecklistRow({ row }: { row: ItemRow }) {
  const props = parseProperties(row);
  const done = props.status === "done";

  return (
    <li className="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-neutral-50">
      <input
        type="checkbox"
        checked={done}
        onChange={() => void patchItem(row, { status: done ? "todo" : "done" })}
        className="h-4 w-4 shrink-0 rounded border-neutral-300"
        aria-label={done ? "Mark not done" : "Mark done"}
      />
      <InlineText
        value={props.title}
        onCommit={(title) => void patchItem(row, { title })}
        placeholder="Untitled"
        className={
          "flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-300 " +
          (done ? "text-neutral-400 line-through" : "text-neutral-800")
        }
      />
      <button
        type="button"
        onClick={() => void deleteItem(row.id)}
        className="invisible shrink-0 rounded px-1 text-neutral-300 hover:text-red-500 group-hover:visible"
        aria-label="Delete item"
      >
        ×
      </button>
    </li>
  );
}
