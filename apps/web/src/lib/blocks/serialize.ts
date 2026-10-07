/**
 * Block ⇄ replica serialization.
 *
 * Blocks are rows in the local `blocks` table, owned by exactly one of a page or an item's
 * description (see migration 0004). BlockNote owns the block ids and types; the rest of a
 * block (props, inline content, children) round-trips through the `content` column as a JSON
 * string. All writes go to the local replica — PowerSync queues and uploads them via the
 * connector. There is NO network code here.
 *
 * Everything is keyed on a `BlockOwner` rather than a page id, so the page editor and the card
 * description share one implementation; the owner decides which column is set and which rows
 * are read back.
 */
import type { PartialBlock } from "@blocknote/core";

import { db } from "../powersync/client";
import { fingerprintRows, ownerKeyOf, publishSelfWrite } from "./self-writes";

/** Which thing a set of blocks belongs to. */
export type BlockOwner = { kind: "page"; id: string } | { kind: "item"; id: string };

export const pageOwner = (id: string): BlockOwner => ({ kind: "page", id });
export const itemOwner = (id: string): BlockOwner => ({ kind: "item", id });

/** The column that carries the owner id — the other one is always NULL. */
function ownerColumn(owner: BlockOwner): "page_id" | "item_id" {
  return owner.kind === "page" ? "page_id" : "item_id";
}

/** A `blocks` row as we author it. These columns are always set for rows we write. */
export interface BlockRow {
  id: string;
  workspace_id: string;
  page_id: string | null;
  item_id: string | null;
  type: string;
  content: string; // JSON string: { props, content, children }
  position: number;
  created_at: string;
  updated_at: string;
}

/**
 * The shape `persistBlocks` needs from a BlockNote document — deliberately STRUCTURAL rather
 * than `Block[]`. The editor's document type is parameterised by its schema, so naming the
 * concrete type here would drag the editor's schema into every module that saves blocks (and
 * break the moment the schema gains an inline node, which it has: see `pageLink`). These five
 * fields are all this module ever reads.
 */
export interface PersistableBlock {
  id: string;
  type: string;
  props?: unknown;
  content?: unknown;
  children?: unknown;
}

/** The BlockNote fields we persist inside the `content` JSON column. */
interface StoredBlockContent {
  props?: Record<string, unknown>;
  content?: unknown;
  children?: unknown;
}

/**
 * Load an owner's blocks once, ordered by position. This is a ONE-SHOT read, not a reactive
 * subscription: an open editor must not be re-hydrated from the replica or it would fight
 * BlockNote's own document state. An edit that arrives from another device is therefore
 * reported rather than applied — see `external-edit.ts` — and re-reading is the user's call.
 */
export async function loadBlocks(owner: BlockOwner): Promise<BlockRow[]> {
  // Never read behind our own pending write. A re-hydrate (the "updated elsewhere" reload)
  // happens right after the outgoing editor flushes, so without this the read can miss the
  // very edit that flush is saving and the user watches their last sentence disappear.
  await (inFlight.get(`${owner.kind}:${owner.id}`) ?? Promise.resolve()).catch(() => undefined);
  return db.getAll<BlockRow>(
    `SELECT * FROM blocks WHERE ${ownerColumn(owner)} = ? ORDER BY position`,
    [owner.id],
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
 * Persist an editor's current document to the local replica in ONE transaction:
 *   - upsert every block (position = array index), and
 *   - delete blocks of this owner that are no longer present.
 * PowerSync turns the resulting local CRUD into an upload — nothing here touches the network.
 */
const inFlight = new Map<string, Promise<void>>();

export function persistBlocks(
  owner: BlockOwner,
  workspaceId: string,
  blocks: readonly PersistableBlock[],
): Promise<void> {
  // Serialise per owner. The upsert is UPDATE-then-INSERT (PowerSync tables are SQLite views,
  // so `ON CONFLICT` is rejected), which is only safe if one save runs at a time: two
  // overlapping saves of the same document both find no row to UPDATE and both INSERT, and the
  // second fails with "UNIQUE constraint failed". A debounced save and an unmount flush can
  // genuinely coincide, so chain them rather than relying on callers.
  const key = `${owner.kind}:${owner.id}`;
  const previous = inFlight.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => writeBlocks(owner, workspaceId, blocks))
    .finally(() => {
      if (inFlight.get(key) === next) inFlight.delete(key);
    });
  inFlight.set(key, next);
  return next;
}

async function writeBlocks(
  owner: BlockOwner,
  workspaceId: string,
  blocks: readonly PersistableBlock[],
): Promise<void> {
  const now = new Date().toISOString();
  const column = ownerColumn(owner);
  const pageId = owner.kind === "page" ? owner.id : null;
  const itemId = owner.kind === "item" ? owner.id : null;
  const ids = blocks.map((block) => block.id);

  await db.writeTransaction(async (tx) => {
    /*
     * Which of these blocks already exist? This SELECT is not an optimisation — it is the only
     * reliable way to choose between UPDATE and INSERT here.
     *
     * PowerSync tables are SQLite VIEWS, so `INSERT … ON CONFLICT` is rejected AND
     * `execute()` reports `rowsAffected: 0` for an UPDATE even when it changed a row. The old
     * "UPDATE, and INSERT if rowsAffected is 0" upsert therefore ALWAYS ran the INSERT: the
     * first save worked (no row yet), and every save after that hit a UNIQUE violation that
     * rolled the whole transaction back — silently reverting the UPDATE that had just
     * succeeded. Every edit after the first was lost.
     *
     * Checked globally rather than per owner: a block id is unique across the table, so an id
     * belonging to another owner must still be updated (moved), never inserted.
     */
    const existing =
      ids.length > 0
        ? await tx.getAll<{ id: string }>(
            `SELECT id FROM blocks WHERE id IN (${ids.map(() => "?").join(", ")})`,
            ids,
          )
        : [];
    const existingIds = new Set(existing.map((row) => row.id));

    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index];
      const content = JSON.stringify({
        props: block.props,
        content: block.content,
        children: block.children,
      });
      if (existingIds.has(block.id)) {
        await tx.execute(
          `UPDATE blocks SET workspace_id = ?, page_id = ?, item_id = ?, type = ?, content = ?,
             position = ?, updated_at = ? WHERE id = ?`,
          [workspaceId, pageId, itemId, block.type, content, index, now, block.id],
        );
      } else {
        await tx.execute(
          `INSERT INTO blocks
             (id, workspace_id, page_id, item_id, type, content, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [block.id, workspaceId, pageId, itemId, block.type, content, index, now, now],
        );
      }
    }

    // Remove blocks the user deleted. Guard the empty-document case (SQL `IN ()` is invalid).
    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(", ");
      await tx.execute(`DELETE FROM blocks WHERE ${column} = ? AND id NOT IN (${placeholders})`, [
        owner.id,
        ...ids,
      ]);
    } else {
      await tx.execute(`DELETE FROM blocks WHERE ${column} = ?`, [owner.id]);
    }
  });

  /*
   * Tell the "updated elsewhere" watcher what this device just wrote. Every row above carries
   * `now`, and the DELETE removed the rest, so these pairs ARE the owner's complete state as
   * of this commit — anything the replica holds beyond them came from another device.
   * Published here rather than by the caller so it cannot drift from the write itself.
   */
  publishSelfWrite(
    ownerKeyOf(owner.kind, owner.id),
    fingerprintRows(ids.map((id) => ({ id, updated_at: now }))),
  );
}
