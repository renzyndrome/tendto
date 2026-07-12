/** Table view: editable Title / Status / Due / Assignee cells. Status options are the board columns. */
import {
  parseProperties,
  patchItem,
  type Column,
  type ItemRow,
} from "../../../lib/items/mutations";
import { InlineText } from "./inline-text";

export function TableView({ items, columns }: { items: ItemRow[]; columns: Column[] }) {
  if (items.length === 0) {
    return <p className="py-10 text-center text-sm text-neutral-400">No items yet — add one above.</p>;
  }
  return (
    <table data-testid="table" className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-400">
          <th className="py-2 pr-4 font-medium">Title</th>
          <th className="py-2 pr-4 font-medium">Status</th>
          <th className="py-2 pr-4 font-medium">Due</th>
          <th className="py-2 pr-4 font-medium">Assignee</th>
        </tr>
      </thead>
      <tbody>
        {items.map((row) => {
          const props = parseProperties(row);
          const known = columns.some((c) => c.id === props.status);
          return (
            <tr key={row.id} className="border-b border-neutral-100">
              <td className="py-1 pr-4">
                <InlineText
                  value={props.title}
                  onCommit={(title) => void patchItem(row, { title })}
                  placeholder="Untitled"
                  className="w-full bg-transparent px-1 py-0.5 text-sm text-neutral-800 outline-none placeholder:text-neutral-300 focus:bg-neutral-50"
                />
              </td>
              <td className="py-1 pr-4">
                <select
                  value={props.status}
                  onChange={(e) => void patchItem(row, { status: e.target.value })}
                  className="rounded border border-neutral-200 bg-white px-1.5 py-1 text-sm text-neutral-700"
                >
                  {/* Keep an orphaned status visible until the user re-picks a column. */}
                  {known ? null : <option value={props.status}>{props.status}</option>}
                  {columns.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.label}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-1 pr-4">
                <input
                  type="date"
                  value={props.due ?? ""}
                  onChange={(e) => void patchItem(row, { due: e.target.value })}
                  className="rounded border border-neutral-200 px-1.5 py-1 text-sm text-neutral-700"
                />
              </td>
              <td className="py-1 pr-4">
                <InlineText
                  value={props.assignee ?? ""}
                  onCommit={(assignee) => void patchItem(row, { assignee })}
                  placeholder="—"
                  className="w-full bg-transparent px-1 py-0.5 text-sm text-neutral-700 outline-none placeholder:text-neutral-300 focus:bg-neutral-50"
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
