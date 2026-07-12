/**
 * Collection mutations — create and delete (with items cascade). Item-level mutations live in
 * `lib/items/mutations.ts`. All writes go to the local replica; PowerSync uploads them.
 */
import { db } from "./powersync/client";

/** Create a collection (defaults to the board view). Returns the new collection id. */
export async function createCollection(workspaceId: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO collections (id, workspace_id, name, default_view, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, workspaceId, "Untitled", "board", now, now],
  );
  return id;
}

/** Delete a collection and all of its items. */
export async function deleteCollectionCascade(collectionId: string): Promise<void> {
  await db.writeTransaction(async (tx) => {
    await tx.execute("DELETE FROM items WHERE collection_id = ?", [collectionId]);
    await tx.execute("DELETE FROM collections WHERE id = ?", [collectionId]);
  });
}
