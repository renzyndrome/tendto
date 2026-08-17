/** Table view: editable Title / Status / Due / Assignee cells. Status options are the board columns. */
import {
  parseProperties,
  patchItem,
  type Column,
  type ItemRow,
} from "../../../lib/items/mutations";
import { AssigneePicker } from "./assignee-picker";
import { DuePicker } from "./due-picker";
import { InlineText } from "./inline-text";

export function TableView({
  items,
  columns,
  workspaceId,
  onOpen,
}: {
  items: ItemRow[];
  columns: Column[];
  workspaceId: string | null;
  /** Open the card's detail dialog — the only place a description can be edited. */
  onOpen: (itemId: string) => void;
}) {
  if (items.length === 0) {
    return <p className="py-10 text-center text-sm text-subtle">No items yet — add one above.</p>;
  }
  return (
    <table data-testid="table" className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-subtle">
          <th className="py-2 pr-4 font-medium">Title</th>
          <th className="py-2 pr-4 font-medium">Status</th>
          <th className="py-2 pr-4 font-medium">Due</th>
          <th className="py-2 pr-4 font-medium">Assignee</th>
          <th className="py-2 font-medium" />
        </tr>
      </thead>
      <tbody>
        {items.map((row) => {
          const props = parseProperties(row);
          const known = columns.some((c) => c.id === props.status);
          return (
            <tr key={row.id} className="border-b border-line">
              <td className="py-1 pr-4">
                <InlineText
                  value={props.title}
                  onCommit={(title) => void patchItem(row, { title })}
                  placeholder="Untitled"
                  className="w-full bg-transparent px-1 py-0.5 text-sm text-fg outline-none placeholder:text-subtle focus:bg-surface"
                />
              </td>
              <td className="py-1 pr-4">
                <select
                  value={props.status}
                  onChange={(e) => void patchItem(row, { status: e.target.value })}
                  className="rounded border border-line bg-elevated px-1.5 py-1 text-sm text-muted"
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
                <DuePicker
                  value={typeof props.due === "string" ? props.due : ""}
                  onChange={(due) => void patchItem(row, { due })}
                  compact
                  idPrefix={`row-due-${row.id}`}
                />
              </td>
              <td className="py-1 pr-4">
                <AssigneePicker
                  workspaceId={workspaceId}
                  value={typeof props.assignee === "string" ? props.assignee : ""}
                  onChange={(assignee) => void patchItem(row, { assignee })}
                  ariaLabel="Row assignee"
                  className="w-full rounded border border-line bg-app px-1.5 py-1 text-sm text-muted outline-none"
                />
              </td>
              <td className="py-1">
                <button
                  type="button"
                  onClick={() => onOpen(row.id)}
                  aria-label={`Open ${props.title || "Untitled"}`}
                  className="rounded px-1.5 py-0.5 text-xs text-subtle hover:bg-hover hover:text-fg"
                >
                  Open
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
