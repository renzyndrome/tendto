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
  "bg-subtle",
  "bg-amber-400",
  "bg-emerald-500",
  "bg-sky-400",
  "bg-violet-400",
  "bg-rose-400",
];

/** A stable dot color for the column at `index` (cycles through the palette). */
export function columnColor(index: number): string {
  if (index < 0) return "bg-subtle";
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
      .map((c) => ({ id: c.id, label: typeof c.label === "string" && c.label ? c.label : c.id }));
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
  assignee?: string;
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
  return { ...raw, title, status };
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
 * Read the item's LATEST properties from inside the caller's write transaction, not from the
 * caller's snapshot.
 *
 * The read MUST share a transaction with the write that follows. Properties are a whole-bag
 * column, so a patch is read-modify-write; callers fire these off without awaiting (a title
 * commit on blur, then a due date a moment later), and outside a transaction the second read
 * can happen before the first write commits — the second patch then merges onto a stale bag and
 * silently drops the first field. That really happened: setting a title and then a due date lost
 * the title.
 */
async function currentPropertiesIn(
  tx: { getAll: <T>(sql: string, params?: unknown[]) => Promise<T[]> },
  row: ItemRow,
): Promise<ItemProperties> {
  const rows = await tx.getAll<{ properties: string }>(
    "SELECT properties FROM items WHERE id = ?",
    [row.id],
  );
  return parseProperties(rows[0] ? { ...row, properties: rows[0].properties } : row);
}

/** Merge a partial patch into the item's properties (whole-bag write; keeps status columns in sync). */
export async function patchItem(row: ItemRow, patch: Partial<ItemProperties>): Promise<void> {
  await db.writeTransaction(async (tx) => {
    const next = { ...(await currentPropertiesIn(tx, row)), ...patch };
    await tx.execute("UPDATE items SET properties = ?, updated_at = ? WHERE id = ?", [
      JSON.stringify(next),
      new Date().toISOString(),
      row.id,
    ]);
  });
}

/** Move an item into a status column (board DnD), appending it to the end of the collection. */
export async function moveItemToStatus(row: ItemRow, status: string): Promise<void> {
  await db.writeTransaction(async (tx) => {
    const next = { ...(await currentPropertiesIn(tx, row)), status };
    const positions = await tx.getAll<{ next: number | null }>(
      "SELECT MAX(position) AS next FROM items WHERE collection_id = ?",
      [row.collection_id],
    );
    await tx.execute("UPDATE items SET properties = ?, position = ?, updated_at = ? WHERE id = ?", [
      JSON.stringify(next),
      (positions[0]?.next ?? -1) + 1,
      new Date().toISOString(),
      row.id,
    ]);
  });
}

/**
 * Delete an item and its description blocks. Postgres cascades blocks from the item FK, but
 * the local replica has no foreign keys, so the cascade is explicit here — exactly as
 * deletePageCascade does for a page's blocks. Both deletes sync up.
 */
export async function deleteItem(id: string): Promise<void> {
  await db.writeTransaction(async (tx) => {
    await tx.execute("DELETE FROM blocks WHERE item_id = ?", [id]);
    await tx.execute("DELETE FROM items WHERE id = ?", [id]);
  });
}
