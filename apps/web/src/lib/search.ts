/**
 * Instant search over the local replica — pages, items, and blocks in the active workspace.
 *
 * Reads are local SQLite (instant, offline, no network). Ranked SQLite FTS5 is the primary
 * path (see `./powersync/fts.ts`); the original `LIKE` scans remain as the fallback for when
 * the index could not be built.
 */
import { parseProperties, type ItemRow } from "./items/mutations";
import { blockRowToText } from "./blocks/text";
import { db } from "./powersync/client";
import { isFtsReady, toPrefixQuery } from "./powersync/fts";

export interface PageHit {
  kind: "page";
  id: string;
  title: string;
}

export interface ItemHit {
  kind: "item";
  id: string;
  collectionId: string;
  title: string;
}

export interface BlockHit {
  kind: "block";
  id: string;
  pageId: string;
  preview: string;
}

export type SearchHit = PageHit | ItemHit | BlockHit;

export interface SearchResults {
  pages: PageHit[];
  items: ItemHit[];
  blocks: BlockHit[];
}

export const EMPTY_RESULTS: SearchResults = { pages: [], items: [], blocks: [] };

const PER_GROUP = 8;

/** Escape LIKE wildcards in user input so `%`/`_` are matched literally (paired with ESCAPE). */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function totalHits(results: SearchResults): number {
  return results.pages.length + results.items.length + results.blocks.length;
}

/** First hit in display order (pages → items → blocks), for "Enter opens top result". */
export function firstHit(results: SearchResults): SearchHit | undefined {
  return results.pages[0] ?? results.items[0] ?? results.blocks[0];
}

export async function searchWorkspace(
  workspaceId: string,
  query: string,
): Promise<SearchResults> {
  const trimmed = query.trim();
  if (!trimmed) return EMPTY_RESULTS;

  if (isFtsReady()) {
    const match = toPrefixQuery(trimmed);
    if (match) {
      try {
        return await ftsSearch(workspaceId, match);
      } catch (err) {
        // A malformed FTS expression or a missing index must not lose the user their search.
        console.error("FTS query failed; falling back to LIKE scan", err);
      }
    }
  }
  return likeSearch(workspaceId, trimmed);
}

/** Ranked FTS5 search (bm25 via `rank`), reading the indexed copies of title/body. */
async function ftsSearch(workspaceId: string, match: string): Promise<SearchResults> {
  const [pageRows, itemRows, blockRows] = await Promise.all([
    db.getAll<{ id: string; title: string }>(
      "SELECT id, title FROM fts_pages WHERE workspace_id = ? AND fts_pages MATCH ? " +
        "ORDER BY rank LIMIT ?",
      [workspaceId, match, PER_GROUP],
    ),
    db.getAll<{ id: string; collection_id: string; title: string }>(
      "SELECT id, collection_id, title FROM fts_items WHERE workspace_id = ? " +
        "AND fts_items MATCH ? ORDER BY rank LIMIT ?",
      [workspaceId, match, PER_GROUP],
    ),
    // page_id IS NOT NULL: item descriptions are blocks too, but a block hit navigates to a
    // page, so they are found via their item instead.
    db.getAll<{ id: string; page_id: string; body: string }>(
      "SELECT id, page_id, body FROM fts_blocks WHERE workspace_id = ? AND page_id IS NOT NULL " +
        "AND fts_blocks MATCH ? ORDER BY rank LIMIT ?",
      [workspaceId, match, PER_GROUP],
    ),
  ]);

  return {
    pages: pageRows.map((row) => ({ kind: "page", id: row.id, title: row.title || "Untitled" })),
    items: itemRows.map((row) => ({
      kind: "item",
      id: row.id,
      collectionId: row.collection_id,
      title: row.title || "Untitled",
    })),
    blocks: blockRows
      .map((row) => ({ kind: "block" as const, id: row.id, pageId: row.page_id, preview: row.body }))
      .filter((hit) => hit.preview.trim().length > 0),
  };
}

/** Substring fallback, used only when the FTS index is unavailable. */
async function likeSearch(workspaceId: string, trimmed: string): Promise<SearchResults> {
  const like = `%${escapeLike(trimmed)}%`;

  const [pageRows, itemRows, blockRows] = await Promise.all([
    db.getAll<{ id: string; title: string }>(
      "SELECT id, title FROM pages WHERE workspace_id = ? AND title LIKE ? ESCAPE '\\' " +
        "ORDER BY updated_at DESC LIMIT ?",
      [workspaceId, like, PER_GROUP],
    ),
    db.getAll<ItemRow>(
      "SELECT * FROM items WHERE workspace_id = ? " +
        "AND json_extract(properties, '$.title') LIKE ? ESCAPE '\\' LIMIT ?",
      [workspaceId, like, PER_GROUP],
    ),
    // Raw match against the block's JSON text — good enough for MVP; FTS5 later.
    db.getAll<{ id: string; page_id: string; content: string }>(
      // page_id IS NOT NULL: item descriptions are blocks too, but a block hit navigates to a
      // page, so they are found via their item instead.
      "SELECT id, page_id, content FROM blocks WHERE workspace_id = ? AND page_id IS NOT NULL " +
        "AND content LIKE ? ESCAPE '\\' " +
        "LIMIT ?",
      [workspaceId, like, PER_GROUP],
    ),
  ]);

  return {
    pages: pageRows.map((row) => ({ kind: "page", id: row.id, title: row.title || "Untitled" })),
    items: itemRows.map((row) => ({
      kind: "item",
      id: row.id,
      collectionId: row.collection_id,
      title: parseProperties(row).title || "Untitled",
    })),
    blocks: blockRows
      .map((row) => ({
        kind: "block" as const,
        id: row.id,
        pageId: row.page_id,
        preview: blockRowToText(row.content),
      }))
      .filter((hit) => hit.preview.trim().length > 0),
  };
}
