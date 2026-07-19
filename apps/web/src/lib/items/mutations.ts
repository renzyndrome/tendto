/**
 * Item mutations — the write side of collections.
 *
 * An item is a row in `items` with a JSONB `properties` bag (stored as a JSON string in the
 * replica). The SAME items render as checklist / list / table / board — views are projections,
 * never separate data. Conflicts resolve last-write-wins at row granularity, so every write
 * persists the WHOLE properties bag (merged locally) plus a fresh `updated_at`. All writes go to
 * the local replica; PowerSync uploads them via the connector. No network code here.
 */
import { db } from "../powersync/client";

/** A board status column. `id` is what's stored in `item.properties.status`; `label` is display. */
export interface Column {
  id: string;
  label: string;
}

/** Boards default to these three when a collection has no custom columns configured. */
export const DEFAULT_COLUMNS: Column[] = [
  { id: "todo", label: "To do" },
  { id: "doing", label: "In progress" },
  { id: "done", label: "Done" },
];

const COLUMN_PALETTE = [
  "bg-neutral-300",
  "bg-amber-400",
  "bg-emerald-500",
  "bg-sky-400",
  "bg-violet-400",
  "bg-rose-400",
];

/** A stable dot color for the column at `index` (cycles through the palette). */
export function columnColor(index: number): string {
  if (index < 0) return "bg-neutral-300";
  return COLUMN_PALETTE[index % COLUMN_PALETTE.length];
}

/** Parse a collection's board columns from its `config` JSON string; default three when unset. */
export function parseColumns(config: string | null | undefined): Column[] {
  if (!config) return DEFAULT_COLUMNS;
  try {
    const parsed = JSON.parse(config) as { columns?: unknown };
    if (!Array.isArray(parsed.columns)) return DEFAULT_COLUMNS;
    const columns = parsed.columns
      .filter((c): c is Column => !!c && typeof (c as Column).id === "string")
      // Preserve an EMPTY label (a freshly-added, not-yet-named column shows a placeholder in the
      // board header); only fall back to the id when the label is missing/non-string entirely.
      .map((c) => ({ id: c.id, label: typeof c.label === "string" ? c.label : c.id }));
    return columns.length > 0 ? columns : DEFAULT_COLUMNS;
  } catch {
    return DEFAULT_COLUMNS;
  }
}

/** The properties we rely on. `status` is a free-form board-column id. Extra keys pass through. */
export interface ItemProperties {
  title: string;
  status: string;
  due?: string; // ISO date (YYYY-MM-DD)
  assignees?: string[]; // better-auth user ids of assigned workspace members
  assignee?: string; // legacy free-text assignee (read-only fallback; superseded by assignees)
  description?: string;
  [key: string]: unknown;
}

/** An `items` row as stored in the replica (`properties` is a JSON string). */
export interface ItemRow {
  id: string;
  workspace_id: string;
  collection_id: string;
  properties: string;
  position: number;
  created_at: string;
  updated_at: string;
}

/** Parse + sanitize a row's properties bag; invalid title/status fall back to safe defaults. */
export function parseProperties(row: ItemRow): ItemProperties {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(row.properties) as Record<string, unknown>;
  } catch {
    raw = {};
  }
  const title = typeof raw.title === "string" ? raw.title : "";
  const status = typeof raw.status === "string" && raw.status ? raw.status : "todo";
  const assignees = Array.isArray(raw.assignees)
    ? raw.assignees.filter((a): a is string => typeof a === "string")
    : undefined;
  return { ...raw, title, status, assignees };
}

async function nextPosition(collectionId: string): Promise<number> {
  const rows = await db.getAll<{ next: number | null }>(
    "SELECT MAX(position) AS next FROM items WHERE collection_id = ?",
    [collectionId],
  );
  return (rows[0]?.next ?? -1) + 1;
}

export async function createItem(
  workspaceId: string,
  collectionId: string,
  props: Partial<ItemProperties> = {},
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const position = await nextPosition(collectionId);
  const properties: ItemProperties = { title: "", status: "todo", ...props };
  await db.execute(
    `INSERT INTO items
       (id, workspace_id, collection_id, properties, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, workspaceId, collectionId, JSON.stringify(properties), position, now, now],
  );
  return id;
}

/**
 * Merge a partial patch into an item's `properties`, one field at a time via SQLite `json_set`.
 *
 * This is ATOMIC per field: json_set updates only the given JSON paths in place (SQLite serializes
 * writers), so several near-simultaneous edits from the detail modal — e.g. title, due, then
 * description — can't clobber one another the way a read-whole-bag-then-write approach can. Object
 * / array values (e.g. `assignees`) are embedded with `json(?)`. PowerSync still captures the full
 * resulting `properties` string as the CRUD op, so the upload path is unchanged.
 *
 * Note: patch keys are code-controlled field names (never user input), so interpolating them into
 * the JSON path is safe; all values are bound parameters.
 */
export async function patchItem(row: ItemRow, patch: Partial<ItemProperties>): Promise<void> {
  const paths: string[] = [];
  const args: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value !== null && typeof value === "object") {
      paths.push(`'$.${key}', json(?)`);
      args.push(JSON.stringify(value));
    } else {
      paths.push(`'$.${key}', ?`);
      args.push(value);
    }
  }
  if (paths.length === 0) return;
  await db.execute(
    `UPDATE items SET properties = json_set(properties, ${paths.join(", ")}), updated_at = ? WHERE id = ?`,
    [...args, new Date().toISOString(), row.id],
  );
}

/** Move an item into a status column (board DnD), appending it to the end of the collection. */
export async function moveItemToStatus(row: ItemRow, status: string): Promise<void> {
  const position = await nextPosition(row.collection_id);
  await db.execute(
    "UPDATE items SET properties = json_set(properties, '$.status', ?), position = ?, updated_at = ? WHERE id = ?",
    [status, position, new Date().toISOString(), row.id],
  );
}

export async function deleteItem(id: string): Promise<void> {
  await db.execute("DELETE FROM items WHERE id = ?", [id]);
}
