/**
 * Page mutations — create, rename, and delete (with descendant cascade). Pages nest via
 * `parent_id`; a page is the unit of "a note / a category". All writes go to the local replica;
 * PowerSync uploads them. No network code here.
 */
import { db } from "./powersync/client";

async function nextPosition(workspaceId: string): Promise<number> {
  const rows = await db.getAll<{ next: number | null }>(
    "SELECT MAX(position) AS next FROM pages WHERE workspace_id = ?",
    [workspaceId],
  );
  return (rows[0]?.next ?? -1) + 1;
}

/** Create a page (optionally nested under `parentId`). Returns the new page id. */
export async function createPage(
  workspaceId: string,
  parentId: string | null = null,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const position = await nextPosition(workspaceId);
  await db.execute(
    `INSERT INTO pages (id, workspace_id, parent_id, title, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, workspaceId, parentId, "Untitled", position, now, now],
  );
  return id;
}

export async function renamePage(pageId: string, title: string): Promise<void> {
  await db.execute("UPDATE pages SET title = ?, updated_at = ? WHERE id = ?", [
    title,
    new Date().toISOString(),
    pageId,
  ]);
}

/**
 * Delete a page and everything under it: all descendant subpages (walked via `parent_id`) and
 * every block of each. `parent_id` isn't a DB foreign key, so the cascade is explicit here; each
 * delete syncs up and Postgres cascades the blocks too.
 *
 * COMMENTS ARE DELIBERATELY NOT DELETED HERE. Only a comment's author (or the workspace owner)
 * may delete it, so an editor removing a page that holds a teammate's comment would queue a
 * DELETE the server answers with 403 — and because the upload queue is ordered and its
 * transaction is never completed on error, that would wedge every later write from the device.
 * The page delete alone is enough: Postgres cascades the comments from the FK, and PowerSync
 * then removes them from every replica. The rows linger locally only until that round-trip, and
 * nothing renders them once their page is gone.
 */
export async function deletePageCascade(pageId: string): Promise<void> {
  const toDelete: string[] = [pageId];
  const queue: string[] = [pageId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const children = await db.getAll<{ id: string }>(
      "SELECT id FROM pages WHERE parent_id = ?",
      [current],
    );
    for (const child of children) {
      toDelete.push(child.id);
      queue.push(child.id);
    }
  }
  await db.writeTransaction(async (tx) => {
    for (const id of toDelete) {
      await tx.execute("DELETE FROM blocks WHERE page_id = ?", [id]);
      await tx.execute("DELETE FROM pages WHERE id = ?", [id]);
    }
  });
}
