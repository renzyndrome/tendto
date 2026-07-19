/**
 * Instant search over the local replica — pages, items, and blocks in the active workspace.
 *
 * Reads are local SQLite (instant, offline). MVP uses `LIKE` scans; SQLite FTS5 (ranked,
 * prefix-aware, tokenized) is the later optimization when workspaces grow large. No network.
 */
import { parseProperties, type ItemRow } from "./items/mutations";
import { blockRowToText } from "./blocks/text";
import { db } from "./powersync/client";

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

/** One run of text in a highlighted label — `match` runs get wrapped in <mark> at the edge. */
export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Split `text` into segments around the first case-insensitive contiguous occurrence of `query`.
 * Pure + unit-safe: returns a single unmatched segment when the query is empty or absent, so
 * callers can always render the array without special-casing "no match".
 */
export function highlightMatch(text: string, query: string): HighlightSegment[] {
  const needle = query.trim();
  if (!needle) return [{ text, match: false }];
  const start = text.toLowerCase().indexOf(needle.toLowerCase());
  if (start === -1) return [{ text, match: false }];
  const end = start + needle.length;
  const segments: HighlightSegment[] = [];
  if (start > 0) segments.push({ text: text.slice(0, start), match: false });
  segments.push({ text: text.slice(start, end), match: true });
  if (end < text.length) segments.push({ text: text.slice(end), match: false });
  return segments;
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
      "SELECT id, page_id, content FROM blocks WHERE workspace_id = ? AND content LIKE ? ESCAPE '\\' " +
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
