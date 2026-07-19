/** Table view: inline-editable Title / Status / Due cells; Assignees show member avatars (edited
 *  in the detail modal, which the ⤢ button opens). Status options are the board columns. */
import {
  parseProperties,
  patchItem,
  type Column,
  type ItemRow,
} from "../../../lib/items/mutations";
import type { WorkspaceMembers } from "../../../stores/members";
import { Icon } from "../../ui/icon";
import { AssigneeAvatars } from "./item-meta";
import { InlineText } from "./inline-text";

interface TableViewProps {
  items: ItemRow[];
  columns: Column[];
  members: WorkspaceMembers;
  onOpenItem: (id: string) => void;
}

export function TableView({ items, columns, members, onOpenItem }: TableViewProps) {
  if (items.length === 0) {
    return <p className="py-10 text-center text-sm text-muted">No items yet — add one above.</p>;
  }
  return (
    <table data-testid="table" className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-hairline-strong text-left text-xs uppercase tracking-wide text-faint">
          <th className="py-2 pr-4 font-medium">Title</th>
          <th className="py-2 pr-4 font-medium">Status</th>
          <th className="py-2 pr-4 font-medium">Due</th>
          <th className="py-2 pr-4 font-medium">Assignees</th>
          <th className="w-8 py-2" />
        </tr>
      </thead>
      <tbody>
        {items.map((row) => {
          const props = parseProperties(row);
          const known = columns.some((c) => c.id === props.status);
          return (
            <tr key={row.id} className="group border-b border-hairline">
              <td className="py-1 pr-4">
                <InlineText
                  value={props.title}
                  onCommit={(title) => void patchItem(row, { title })}
                  placeholder="Untitled"
                  className="w-full bg-transparent px-1 py-0.5 text-sm text-body outline-none placeholder:text-muted focus:bg-row-hover"
                />
              </td>
              <td className="py-1 pr-4">
                <select
                  value={props.status}
                  onChange={(e) => void patchItem(row, { status: e.target.value })}
                  className="rounded-input border border-border-soft bg-surface px-1.5 py-1 text-sm text-body"
                >
                  {/* Keep an orphaned status visible until the user re-picks a column. */}
                  {known ? null : <option value={props.status}>{props.status}</option>}
                  {columns.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.label || "Untitled"}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-1 pr-4">
                <input
                  type="date"
                  value={props.due ?? ""}
                  onChange={(e) => void patchItem(row, { due: e.target.value })}
                  className="rounded-input border border-border-soft px-1.5 py-1 text-sm text-body"
                />
              </td>
              <td className="py-1 pr-4">
                <button
                  type="button"
                  onClick={() => onOpenItem(row.id)}
                  className="flex items-center gap-1.5 rounded-row px-1 py-1 hover:bg-row-hover"
                  aria-label="Edit assignees"
                >
                  <AssigneeAvatars assignees={props.assignees} members={members} size={22} />
                  {(props.assignees?.length ?? 0) === 0 ? (
                    <span className="text-sm text-muted">—</span>
                  ) : null}
                </button>
              </td>
              <td className="py-1">
                <button
                  type="button"
                  onClick={() => onOpenItem(row.id)}
                  aria-label="Open task"
                  className="invisible rounded-row p-1 text-muted hover:bg-row-hover hover:text-ink group-hover:visible"
                >
                  <Icon name="more" size={15} />
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
