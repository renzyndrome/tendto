/**
 * Page mutations — create, rename, and delete (with descendant cascade). Pages nest via
 * `parent_id`; a page is the unit of "a note / a category". All writes go to the local replica;
 * PowerSync uploads them. No network code here.
 */
import { db } from "./powersync/client";

/** The name a page gets before you give it one. */
export const AUTO_TITLE = "Untitled";

/**
 * Is this still the name the app chose, rather than one the user typed?
 *
 * Matches "Untitled" and "Untitled 2", "Untitled 3"… — and an empty title, which is what you
 * are left with after clearing the box. Used to decide whether a page counts as "real" yet,
 * whether its title should be selected on focus, and which auto numbers are free.
 */
export function isAutoTitle(title: string): boolean {
  const trimmed = title.trim();
  return trimmed === "" || /^Untitled(?: \d+)?$/.test(trimmed);
}

/**
 * The next free auto name: "Untitled", then "Untitled 2", "Untitled 3"…
 *
 * Only pages that are STILL auto-named hold a number, so naming one frees its slot again and
 * the list does not creep upward forever. Numbering starts at 2 because the first one reads
 * better without a "1" after it.
 */
async function nextAutoTitle(workspaceId: string): Promise<string> {
  const rows = await db.getAll<{ title: string }>(
    "SELECT title FROM pages WHERE workspace_id = ? AND title LIKE ?",
    [workspaceId, `${AUTO_TITLE}%`],
  );
  const taken = new Set(rows.map((row) => row.title.trim()));
  if (!taken.has(AUTO_TITLE)) return AUTO_TITLE;
  for (let n = 2; ; n += 1) {
    const candidate = `${AUTO_TITLE} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

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
  const [position, title] = await Promise.all([
    nextPosition(workspaceId),
    nextAutoTitle(workspaceId),
  ]);
  await db.execute(
    `INSERT INTO pages (id, workspace_id, parent_id, title, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, workspaceId, parentId, title, position, now, now],
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
