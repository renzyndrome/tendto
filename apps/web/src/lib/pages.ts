/**
 * Page mutations — create, rename, move, and delete (with descendant cascade). Pages nest via
 * `parent_id`. A folder is a pages row with `kind = 'folder'`: it has no body and only groups
 * pages, but it shares the tree, the cascade and the sync path. All writes go to the local
 * replica; PowerSync uploads them. No network code here.
 */
import { db } from "./powersync/client";

/** The name a page gets before you give it one. */
export const AUTO_TITLE = "Untitled";

/** What a pages row is. Anything but "folder" (including NULL from older rows) is a page. */
export type PageKind = "page" | "folder";

/**
 * SQL predicate for "this pages row is a page, not a folder", for queries on `pages` itself.
 * NULL is a page: rows synced before migration 0009 carry no kind.
 */
export const IS_PAGE_SQL = "coalesce(kind, 'page') <> 'folder'";

/**
 * The same filter for the FTS mirror, which has no `kind` column. Filtering at query time keeps
 * the index shape unchanged; a new column would need the virtual table rebuilt on every device.
 */
export const NOT_A_FOLDER_ID_SQL =
  "id NOT IN (SELECT id FROM pages WHERE kind = 'folder')";

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
function pickAutoTitle(taken: Set<string>): string {
  if (!taken.has(AUTO_TITLE)) return AUTO_TITLE;
  for (let n = 2; ; n += 1) {
    const candidate = `${AUTO_TITLE} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Create a page (optionally nested under `parentId`). Returns the new page id. */
export async function createPage(
  workspaceId: string,
  parentId: string | null = null,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  /*
   * Read and insert in ONE transaction. Both the position and the auto name are chosen from
   * what the table already holds, so two creates started before either had committed would
   * read the same answer and pick the same name — which is exactly what clicking "New page"
   * twice quickly does, since the handler does not block the button.
   */
  await db.writeTransaction(async (tx) => {
    const [positions, titles] = await Promise.all([
      tx.getAll<{ next: number | null }>(
        "SELECT MAX(position) AS next FROM pages WHERE workspace_id = ?",
        [workspaceId],
      ),
      // Folder names never hold an auto number, so they are left out of the pick.
      tx.getAll<{ title: string }>(
        `SELECT title FROM pages WHERE workspace_id = ? AND title LIKE ? AND ${IS_PAGE_SQL}`,
        [workspaceId, `${AUTO_TITLE}%`],
      ),
    ]);
    const position = (positions[0]?.next ?? -1) + 1;
    const title = pickAutoTitle(new Set(titles.map((row) => row.title.trim())));

    await tx.execute(
      `INSERT INTO pages (id, workspace_id, parent_id, title, kind, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'page', ?, ?, ?)`,
      [id, workspaceId, parentId, title, position, now, now],
    );
  });
  return id;
}

/**
 * Create a folder (optionally inside `parentId`) with the name typed into the tree. A folder
 * has no body, so it gets no auto name: the tree only calls this once a name exists.
 */
export async function createFolder(
  workspaceId: string,
  parentId: string | null,
  name: string,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.writeTransaction(async (tx) => {
    const positions = await tx.getAll<{ next: number | null }>(
      "SELECT MAX(position) AS next FROM pages WHERE workspace_id = ?",
      [workspaceId],
    );
    const position = (positions[0]?.next ?? -1) + 1;
    await tx.execute(
      `INSERT INTO pages (id, workspace_id, parent_id, title, kind, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'folder', ?, ?, ?)`,
      [id, workspaceId, parentId, name, position, now, now],
    );
  });
  return id;
}

/**
 * Move a page or folder under `newParentId` (null = top level). It lands last in its new place.
 *
 * Refused (returns false) when the target is the row itself or anything inside it: that would
 * make a loop no path from the top level reaches, and the whole branch would vanish from the
 * tree. The check reads the replica inside the write transaction, so it sees the same tree the
 * write lands on.
 */
export async function movePage(
  pageId: string,
  newParentId: string | null,
): Promise<boolean> {
  if (newParentId === pageId) return false;
  return db.writeTransaction(async (tx) => {
    const rows = await tx.getAll<{
      parent_id: string | null;
      workspace_id: string;
    }>("SELECT parent_id, workspace_id FROM pages WHERE id = ?", [pageId]);
    const row = rows[0];
    if (!row) return false;
    if ((row.parent_id ?? null) === newParentId) return true; // already there

    // Walk up from the target. Reaching the moved row means the target is inside it.
    const seen = new Set<string>();
    let cursor = newParentId;
    while (cursor !== null && !seen.has(cursor)) {
      if (cursor === pageId) return false;
      seen.add(cursor);
      const up = await tx.getAll<{ parent_id: string | null }>(
        "SELECT parent_id FROM pages WHERE id = ?",
        [cursor],
      );
      cursor = up[0]?.parent_id ?? null;
    }

    const positions = await tx.getAll<{ next: number | null }>(
      "SELECT MAX(position) AS next FROM pages WHERE workspace_id = ?",
      [row.workspace_id],
    );
    await tx.execute(
      "UPDATE pages SET parent_id = ?, position = ?, updated_at = ? WHERE id = ?",
      [
        newParentId,
        (positions[0]?.next ?? -1) + 1,
        new Date().toISOString(),
        pageId,
      ],
    );
    return true;
  });
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
      // Two devices moving folders into each other at once can leave a loop after
      // last-write-wins; without this guard the walk would never end.
      if (toDelete.includes(child.id)) continue;
      toDelete.push(child.id);
      queue.push(child.id);
    }
  }
  await deletePages(toDelete);
}

/**
 * Delete exactly these pages (and folders) and their blocks, in one transaction. The sidebar
 * passes the rows it SHOWS inside the deleted one, rather than walking `parent_id` here: after a
 * concurrent-move loop the tree places loop members at the top level, and a raw walk would also
 * delete rows the confirm never pointed at. Comments are left to the server, as above.
 */
export async function deletePages(ids: readonly string[]): Promise<void> {
  await db.writeTransaction(async (tx) => {
    for (const id of ids) {
      await tx.execute("DELETE FROM blocks WHERE page_id = ?", [id]);
      await tx.execute("DELETE FROM pages WHERE id = ?", [id]);
    }
  });
}
