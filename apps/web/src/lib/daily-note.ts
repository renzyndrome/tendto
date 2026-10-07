/**
 * Daily notes: one page per LOCAL day, marked by `pages.journal_date` (YYYY-MM-DD, the device's
 * own calendar day, never UTC) and kept together in a "Daily notes" folder. Opening a day's note
 * creates it the first time. All writes go to the local replica; PowerSync uploads them.
 */
import type { DBGetUtils } from "@powersync/web";

import { formatDayLabel, parseDateKey } from "./calendar";
import { IS_PAGE_SQL } from "./pages";
import { db } from "./powersync/client";

export const DAILY_NOTES_FOLDER = "Daily notes";

/**
 * The day's note, if one exists. Oldest first: two devices offline on the same morning can each
 * make one, and after sync both must settle on the same page.
 */
async function findDailyNote(
  reader: DBGetUtils,
  workspaceId: string,
  dateKey: string,
  exclude: ReadonlySet<string>,
): Promise<string | null> {
  const rows = await reader.getAll<{ id: string }>(
    `SELECT id FROM pages WHERE workspace_id = ? AND journal_date = ? AND ${IS_PAGE_SQL}
     ORDER BY created_at`,
    [workspaceId, dateKey],
  );
  return rows.find((row) => !exclude.has(row.id))?.id ?? null;
}

/**
 * Where the last daily note lives, if that is still a folder. Found by following a note rather
 * than by name, so renaming the folder keeps it in use; moving the latest note out of it, or
 * deleting it, means a fresh folder next time.
 */
async function findDailyFolder(
  reader: DBGetUtils,
  workspaceId: string,
  exclude: ReadonlySet<string>,
): Promise<string | null> {
  const notes = await reader.getAll<{ id: string; parent_id: string | null }>(
    `SELECT id, parent_id FROM pages WHERE workspace_id = ? AND journal_date IS NOT NULL
     ORDER BY created_at DESC`,
    [workspaceId],
  );
  const parentId = notes.find((note) => !exclude.has(note.id))?.parent_id ?? null;
  if (parentId === null || exclude.has(parentId)) return null;
  const folders = await reader.getAll<{ id: string }>(
    "SELECT id FROM pages WHERE id = ? AND workspace_id = ? AND kind = 'folder'",
    [parentId, workspaceId],
  );
  return folders[0]?.id ?? null;
}

/**
 * The page id of `dateKey`'s daily note in this workspace, created (with its folder) if missing.
 *
 * `exclude` is what the sidebar has just deleted and still offers to Undo: those rows exist
 * until the window closes, but opening one would open a page about to vanish, so they count as
 * gone here and a fresh note is made.
 */
export async function openDailyNote(
  workspaceId: string,
  dateKey: string,
  exclude: ReadonlySet<string> = new Set(),
): Promise<string> {
  const day = parseDateKey(dateKey);
  if (!day) throw new Error(`Not a YYYY-MM-DD date key: ${dateKey}`);

  const existing = await findDailyNote(db, workspaceId, dateKey, exclude);
  if (existing) return existing;

  return db.writeTransaction(async (tx) => {
    // Checked again under the write lock: a second click that also missed above waits here for
    // the first one's insert, then finds that page instead of making another.
    const raced = await findDailyNote(tx, workspaceId, dateKey, exclude);
    if (raced) return raced;

    const now = new Date().toISOString();
    const positions = await tx.getAll<{ next: number | null }>(
      "SELECT MAX(position) AS next FROM pages WHERE workspace_id = ?",
      [workspaceId],
    );
    const next = (positions[0]?.next ?? -1) + 1;

    const found = await findDailyFolder(tx, workspaceId, exclude);
    const folderId = found ?? crypto.randomUUID();
    if (found === null) {
      await tx.execute(
        `INSERT INTO pages (id, workspace_id, parent_id, title, kind, position, created_at, updated_at)
         VALUES (?, ?, NULL, ?, 'folder', ?, ?, ?)`,
        [folderId, workspaceId, DAILY_NOTES_FOLDER, next, now, now],
      );
    }

    const id = crypto.randomUUID();
    const position = found === null ? next + 1 : next;
    await tx.execute(
      `INSERT INTO pages
         (id, workspace_id, parent_id, title, kind, journal_date, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'page', ?, ?, ?, ?)`,
      [id, workspaceId, folderId, formatDayLabel(day), dateKey, position, now, now],
    );
    return id;
  });
}
