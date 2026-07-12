/**
 * Block ⇄ replica serialization.
 *
 * A page's blocks are rows in the local `blocks` table. BlockNote owns the block ids and types;
 * the rest of a block (props, inline content, children) round-trips through the `content` column
 * as a JSON string. All writes go to the local replica — PowerSync queues and uploads them via
 * the connector. There is NO network code here.
 */
import type { Block, PartialBlock } from "@blocknote/core";

import { db } from "../powersync/client";

/** A `blocks` row as we author it. These columns are always set for rows we write. */
export interface BlockRow {
  id: string;
  workspace_id: string;
  page_id: string;
  type: string;
  content: string; // JSON string: { props, content, children }
  position: number;
  created_at: string;
  updated_at: string;
}

/** The BlockNote fields we persist inside the `content` JSON column. */
interface StoredBlockContent {
  props?: Record<string, unknown>;
  content?: unknown;
  children?: unknown;
}

/**
 * Load a page's blocks once, ordered by position. This is a ONE-SHOT read, not a reactive
 * subscription: an open editor must not be re-hydrated from the replica or it would fight
 * BlockNote's own document state (live external edits to the open page are Phase 2).
 */
export async function loadBlocks(pageId: string): Promise<BlockRow[]> {
  return db.getAll<BlockRow>(
    "SELECT * FROM blocks WHERE page_id = ? ORDER BY position",
    [pageId],
  );
}

/** Reconstruct a BlockNote PartialBlock from a stored row (id + type come from columns). */
export function rowToBlock(row: BlockRow): PartialBlock {
  let stored: StoredBlockContent = {};
  try {
    stored = JSON.parse(row.content) as StoredBlockContent;
  } catch {
    stored = {};
  }
  return { ...stored, id: row.id, type: row.type } as PartialBlock;
}

/**
 * Persist the editor's current document to the local replica in ONE transaction:
 *   - upsert every block (position = array index), and
 *   - delete blocks that are no longer present.
 * PowerSync turns the resulting local CRUD into an upload — nothing here touches the network.
 */
export async function persistBlocks(
  pageId: string,
  workspaceId: string,
  blocks: Block[],
): Promise<void> {
  const now = new Date().toISOString();

  await db.writeTransaction(async (tx) => {
    const ids: string[] = [];

    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index];
      ids.push(block.id);
      const content = JSON.stringify({
        props: block.props,
        content: block.content,
        children: block.children,
      });
      // PowerSync tables are SQLite VIEWS — `INSERT … ON CONFLICT` ("UPSERT a view") is rejected.
      // Upsert the supported way: UPDATE first, INSERT only if the row didn't exist yet.
      const updated = await tx.execute(
        `UPDATE blocks SET workspace_id = ?, page_id = ?, type = ?, content = ?, position = ?,
           updated_at = ? WHERE id = ?`,
        [workspaceId, pageId, block.type, content, index, now, block.id],
      );
      if (!updated.rowsAffected) {
        await tx.execute(
          `INSERT INTO blocks
             (id, workspace_id, page_id, type, content, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [block.id, workspaceId, pageId, block.type, content, index, now, now],
        );
      }
    }

    // Remove blocks the user deleted. Guard the empty-document case (SQL `IN ()` is invalid).
    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(", ");
      await tx.execute(
        `DELETE FROM blocks WHERE page_id = ? AND id NOT IN (${placeholders})`,
        [pageId, ...ids],
      );
    } else {
      await tx.execute("DELETE FROM blocks WHERE page_id = ?", [pageId]);
    }
  });
}
