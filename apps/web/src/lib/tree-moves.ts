/**
 * Moving a row between folders, shared by the two sidebar trees (pages and collections). Both
 * tables nest through a plain `parent_id`, so the rules are the same; only pages keep a
 * `position` to land last by.
 */
import { db } from "./powersync/client";

/** The tables a folder tree is built from. A literal union: the name goes into the SQL text. */
export type TreeTable = "pages" | "collections";

/**
 * The name as it is written into SQL, looked up rather than passed through: a value outside the
 * union at runtime yields `undefined` and a failed query, never text spliced into the statement.
 */
const TABLE_SQL: Record<TreeTable, string> = { pages: "pages", collections: "collections" };

/**
 * Move a row under `newParentId` (null = top level).
 *
 * Refused (returns false) when the target is the row itself or anything inside it: that would
 * make a loop no path from the top level reaches, and the whole branch would vanish from the
 * tree. The check reads the replica inside the write transaction, so it sees the same tree the
 * write lands on.
 */
export async function moveRow(
  tableName: TreeTable,
  id: string,
  newParentId: string | null,
  { appendPosition }: { appendPosition: boolean },
): Promise<boolean> {
  if (newParentId === id) return false;
  const table = TABLE_SQL[tableName];
  return db.writeTransaction(async (tx) => {
    const rows = await tx.getAll<{ parent_id: string | null; workspace_id: string }>(
      `SELECT parent_id, workspace_id FROM ${table} WHERE id = ?`,
      [id],
    );
    const row = rows[0];
    if (!row) return false;
    if ((row.parent_id ?? null) === newParentId) return true; // already there

    // Walk up from the target. Reaching the moved row means the target is inside it.
    const seen = new Set<string>();
    let cursor = newParentId;
    while (cursor !== null && !seen.has(cursor)) {
      if (cursor === id) return false;
      seen.add(cursor);
      const up = await tx.getAll<{ parent_id: string | null }>(
        `SELECT parent_id FROM ${table} WHERE id = ?`,
        [cursor],
      );
      cursor = up[0]?.parent_id ?? null;
    }

    const now = new Date().toISOString();
    if (appendPosition) {
      const positions = await tx.getAll<{ next: number | null }>(
        `SELECT MAX(position) AS next FROM ${table} WHERE workspace_id = ?`,
        [row.workspace_id],
      );
      await tx.execute(
        `UPDATE ${table} SET parent_id = ?, position = ?, updated_at = ? WHERE id = ?`,
        [newParentId, (positions[0]?.next ?? -1) + 1, now, id],
      );
    } else {
      await tx.execute(`UPDATE ${table} SET parent_id = ?, updated_at = ? WHERE id = ?`, [
        newParentId,
        now,
        id,
      ]);
    }
    return true;
  });
}

/**
 * Put a row at an exact spot: under `newParentId`, with `orderedIds` (which includes the row)
 * as the new order of its sibling group. Positions are rewritten 0..n-1 for that group only,
 * and only rows whose position actually changes are written, so a reorder uploads as few rows
 * as it can. Refused (false) for a drop inside the row's own subtree, like `moveRow`.
 */
export async function placeRow(
  tableName: TreeTable,
  id: string,
  newParentId: string | null,
  orderedIds: readonly string[],
): Promise<boolean> {
  if (newParentId === id) return false;
  const table = TABLE_SQL[tableName];
  return db.writeTransaction(async (tx) => {
    const seen = new Set<string>();
    let cursor = newParentId;
    while (cursor !== null && !seen.has(cursor)) {
      if (cursor === id) return false;
      seen.add(cursor);
      const up = await tx.getAll<{ parent_id: string | null }>(
        `SELECT parent_id FROM ${table} WHERE id = ?`,
        [cursor],
      );
      cursor = up[0]?.parent_id ?? null;
    }

    const now = new Date().toISOString();
    const current = await tx.getAll<{
      id: string;
      parent_id: string | null;
      position: number | null;
    }>(
      `SELECT id, parent_id, position FROM ${table} WHERE id IN (${orderedIds.map(() => "?").join(", ")})`,
      [...orderedIds],
    );
    const byId = new Map(current.map((row) => [row.id, row]));
    for (const [index, rowId] of orderedIds.entries()) {
      const row = byId.get(rowId);
      if (!row) continue;
      const moving = rowId === id && (row.parent_id ?? null) !== newParentId;
      if (!moving && row.position === index) continue;
      await tx.execute(
        `UPDATE ${table} SET parent_id = ?, position = ?, updated_at = ? WHERE id = ?`,
        [rowId === id ? newParentId : row.parent_id, index, now, rowId],
      );
    }
    return true;
  });
}
