/**
 * The calendar's data source: every date-bearing item across every workspace you belong to.
 *
 * This is the one view that deliberately spans workspaces — a deadline is a deadline whether it
 * came from work or personal, and splitting them means checking two calendars to answer "what's
 * today". Every other surface stays scoped to the active workspace. Chips carry a workspace badge
 * so the mixing is never ambiguous, and opening one switches you into its workspace.
 *
 * Reading across workspaces is safe by construction: sync rules only ever put workspaces you're a
 * member of into the replica, and `useVisibleWorkspaces` additionally drops any the server no
 * longer acknowledges — so the id list passed in here is already the authorised set.
 */
import { useQuery } from "@powersync/react";
import { useMemo } from "react";

import { parseProperties, type ItemRow } from "./items/mutations";
import type { WorkspaceRow } from "./use-workspaces";

export interface CalendarItem {
  /** The full row, for mutations (`patchItem` needs it). */
  row: ItemRow;
  id: string;
  workspaceId: string;
  /** Empty when the workspace isn't in the visible list — the badge is then simply omitted. */
  workspaceName: string;
  collectionId: string;
  title: string;
  /** Raw `due` (`YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`); sorts lexicographically, all-day first. */
  due: string;
}

const DATED =
  "json_extract(properties, '$.due') IS NOT NULL AND json_extract(properties, '$.due') != ''";

/**
 * Items with a due date, optionally narrowed to a single `YYYY-MM-DD`.
 *
 * The day filter is a prefix LIKE rather than a range so it works for both stored shapes; callers
 * still compare the parsed date exactly, since a LIKE would also match a hypothetical longer key.
 */
export function useDatedItems(workspaces: WorkspaceRow[], dateKey?: string): CalendarItem[] {
  const ids = useMemo(() => workspaces.map((workspace) => workspace.id), [workspaces]);

  // `IN ()` is not valid SQLite, so an empty (or still-loading) workspace list asks for nothing.
  const sql = ids.length
    ? `SELECT * FROM items WHERE workspace_id IN (${ids.map(() => "?").join(", ")}) AND ${DATED}` +
      (dateKey ? " AND json_extract(properties, '$.due') LIKE ?" : "")
    : "SELECT * FROM items WHERE 1 = 0";
  const params = ids.length && dateKey ? [...ids, `${dateKey}%`] : ids;

  const { data: rows } = useQuery<ItemRow>(sql, params);

  return useMemo(() => {
    const names = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));
    return rows
      .map((row) => {
        const props = parseProperties(row);
        return {
          row,
          id: row.id,
          workspaceId: row.workspace_id,
          workspaceName: names.get(row.workspace_id) ?? "",
          collectionId: row.collection_id,
          title: props.title || "Untitled",
          due: typeof props.due === "string" ? props.due : "",
        };
      })
      .filter((item) => item.due !== "");
  }, [rows, workspaces]);
}
