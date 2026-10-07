/**
 * Collection mutations — create, move, rename and delete (with items cascade). Item-level
 * mutations live in `lib/items/mutations.ts`. All writes go to the local replica; PowerSync
 * uploads them.
 *
 * A folder in the Collections section is a collections row with `kind = 'folder'` (migration
 * 0010): no items, no view, only a name and a place in the tree. `parent_id` nests a collection
 * or a folder in one, the same shape as pages.
 */
import type { Column } from "./items/mutations";
import { db } from "./powersync/client";
import { moveRow, placeRow } from "./tree-moves";

/** The server column is VARCHAR(200); a longer name would fail the upload and wedge the queue. */
export const COLLECTION_NAME_MAX = 200;

/**
 * Cap a name at COLLECTION_NAME_MAX characters. Counted by code point, not with `slice`: a cut
 * through the middle of an emoji leaves half a surrogate pair, which the server cannot encode.
 */
function capName(name: string): string {
  return Array.from(name).slice(0, COLLECTION_NAME_MAX).join("");
}

/**
 * SQL predicate for "this collections row holds items" — not a folder. NULL is a collection:
 * rows synced before migration 0010 carry no kind.
 */
export const IS_COLLECTION_SQL = "coalesce(kind, 'collection') <> 'folder'";

/**
 * The next position in the workspace, so a new row lands last. Rows from before migration 0011
 * read NULL (sorted as 0, in creation order), which MAX skips.
 */
const NEXT_POSITION_SQL =
  "SELECT coalesce(MAX(position), 0) + 1 AS next FROM collections WHERE workspace_id = ?";

/** Create a collection (defaults to the board view), optionally in a folder. Returns its id. */
export async function createCollection(
  workspaceId: string,
  parentId: string | null = null,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.writeTransaction(async (tx) => {
    const next = await tx.getAll<{ next: number }>(NEXT_POSITION_SQL, [workspaceId]);
    await tx.execute(
      `INSERT INTO collections
         (id, workspace_id, parent_id, name, kind, default_view, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'collection', ?, ?, ?, ?)`,
      [id, workspaceId, parentId, "Untitled", "board", next[0]?.next ?? 1, now, now],
    );
  });
  return id;
}

/**
 * Create a folder in the Collections section with the name typed into the tree. `default_view`
 * is NOT NULL on the server, so a folder carries one it never uses.
 */
export async function createCollectionFolder(
  workspaceId: string,
  parentId: string | null,
  name: string,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.writeTransaction(async (tx) => {
    const next = await tx.getAll<{ next: number }>(NEXT_POSITION_SQL, [workspaceId]);
    await tx.execute(
      `INSERT INTO collections
         (id, workspace_id, parent_id, name, kind, default_view, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'folder', 'board', ?, ?, ?)`,
      [id, workspaceId, parentId, capName(name), next[0]?.next ?? 1, now, now],
    );
  });
  return id;
}

export async function renameCollection(collectionId: string, name: string): Promise<void> {
  await db.execute("UPDATE collections SET name = ?, updated_at = ? WHERE id = ?", [
    capName(name),
    new Date().toISOString(),
    collectionId,
  ]);
}

/** Move a collection or folder under `newParentId` (null = top level), last. See `moveRow`. */
export async function moveCollection(
  collectionId: string,
  newParentId: string | null,
): Promise<boolean> {
  return moveRow("collections", collectionId, newParentId, { appendPosition: true });
}

/** Put a collection or folder at an exact spot among its siblings. See `placeRow`. */
export async function placeCollection(
  collectionId: string,
  newParentId: string | null,
  orderedIds: readonly string[],
): Promise<boolean> {
  return placeRow("collections", collectionId, newParentId, orderedIds);
}

/**
 * Delete exactly these collections and folders, with every item and item description in them,
 * in one transaction. Postgres cascades items from the collection FK; the local replica has no
 * foreign keys, so each level is explicit (the same reason `deleteItem` spells it out). The
 * sidebar passes what its tree SHOWS inside a deleted folder, for the reason given on
 * `deletePages` in lib/pages.ts. A folder has no items, so the same three statements cover it.
 *
 * Comments are deliberately left to the server's FK cascade — see `deletePages` in
 * lib/pages.ts for why deleting a teammate's comment from a parent delete wedges the queue.
 */
export async function deleteCollections(ids: readonly string[]): Promise<void> {
  await db.writeTransaction(async (tx) => {
    const owned = "SELECT id FROM items WHERE collection_id = ?";
    for (const id of ids) {
      await tx.execute(`DELETE FROM blocks WHERE item_id IN (${owned})`, [id]);
      await tx.execute("DELETE FROM items WHERE collection_id = ?", [id]);
      await tx.execute("DELETE FROM collections WHERE id = ?", [id]);
    }
  });
}

// --- board columns (stored in collections.config) ------------------------------------------

/** A fresh board column with a unique id. */
export function newColumn(label: string): Column {
  return { id: crypto.randomUUID(), label };
}

/** Persist the board's column set on the collection. */
export async function setColumns(collectionId: string, columns: Column[]): Promise<void> {
  await db.execute("UPDATE collections SET config = ?, updated_at = ? WHERE id = ?", [
    JSON.stringify({ columns }),
    new Date().toISOString(),
    collectionId,
  ]);
}

/**
 * Delete a column and move its items to the first remaining column (never delete the last one).
 * Persists the reassigned items and the new column set in one pass.
 */
export async function deleteColumn(
  collectionId: string,
  columns: Column[],
  columnId: string,
): Promise<void> {
  const remaining = columns.filter((c) => c.id !== columnId);
  if (remaining.length === 0) return; // a board always keeps at least one column
  const fallback = remaining[0].id;

  const affected = await db.getAll<{ id: string; properties: string }>(
    "SELECT id, properties FROM items WHERE collection_id = ? AND json_extract(properties, '$.status') = ?",
    [collectionId, columnId],
  );
  const now = new Date().toISOString();
  await db.writeTransaction(async (tx) => {
    for (const row of affected) {
      let props: Record<string, unknown> = {};
      try {
        props = JSON.parse(row.properties) as Record<string, unknown>;
      } catch {
        props = {};
      }
      props.status = fallback;
      await tx.execute("UPDATE items SET properties = ?, updated_at = ? WHERE id = ?", [
        JSON.stringify(props),
        now,
        row.id,
      ]);
    }
  });
  await setColumns(collectionId, remaining);
}
