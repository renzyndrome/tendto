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

export const STATUSES = ["todo", "doing", "done"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  todo: "To do",
  doing: "In progress",
  done: "Done",
};

export const STATUS_COLORS: Record<Status, string> = {
  todo: "bg-neutral-300",
  doing: "bg-amber-400",
  done: "bg-emerald-500",
};

export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

/** The properties we rely on. Extra keys are allowed and surfaced in the table view. */
export interface ItemProperties {
  title: string;
  status: Status;
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
  const status = isStatus(raw.status) ? raw.status : "todo";
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
 * Read the item's LATEST properties from the replica (not the caller's snapshot). Whole-bag
 * writes merge onto this, so two quick edits to different fields of the same item (e.g. title
 * then due date) can't clobber each other with a stale base.
 */
async function currentProperties(row: ItemRow): Promise<ItemProperties> {
  const rows = await db.getAll<{ properties: string }>(
    "SELECT properties FROM items WHERE id = ?",
    [row.id],
  );
  return parseProperties(rows[0] ? { ...row, properties: rows[0].properties } : row);
}

/** Merge a partial patch into the item's properties (whole-bag write; keeps status columns in sync). */
export async function patchItem(row: ItemRow, patch: Partial<ItemProperties>): Promise<void> {
  const next = { ...(await currentProperties(row)), ...patch };
  await db.execute("UPDATE items SET properties = ?, updated_at = ? WHERE id = ?", [
    JSON.stringify(next),
    new Date().toISOString(),
    row.id,
  ]);
}

/** Move an item into a status column (board DnD), appending it to the end of the collection. */
export async function moveItemToStatus(row: ItemRow, status: Status): Promise<void> {
  const next = { ...(await currentProperties(row)), status };
  const position = await nextPosition(row.collection_id);
  await db.execute("UPDATE items SET properties = ?, position = ?, updated_at = ? WHERE id = ?", [
    JSON.stringify(next),
    position,
    new Date().toISOString(),
    row.id,
  ]);
}

export async function deleteItem(id: string): Promise<void> {
  await db.execute("DELETE FROM items WHERE id = ?", [id]);
}
