/**
 * Choosing which notes to send with a question.
 *
 * Retrieval happens ON THE DEVICE, against the local full-text index, and only the extracts it
 * picks ever leave. The server never reads the workspace for this: it is handed a question and
 * a numbered bundle of text, exactly as the rewrite tasks hand it a paragraph. That keeps the
 * "every interactive AI action is user-triggered, on content the user chose" rule intact, and
 * it means the amount of workspace exposed to an engine is bounded and visible.
 *
 * The sources are numbered so the answer can cite them and the reader can check the citation.
 */
import { blockRowToText } from "../blocks/text";
import { extractTerms } from "../links/terms";
import { db } from "../powersync/client";
import { isFtsReady, toOrQuery } from "../powersync/fts";

/** One numbered extract, as the answer will cite it. */
export interface Source {
  /** 1-based, matching the `[n]` in the answer. */
  number: number;
  pageId: string;
  title: string;
}

export interface Retrieval {
  /** The numbered bundle sent to the engine. Empty when nothing matched. */
  text: string;
  sources: Source[];
}

export const NOTHING_FOUND: Retrieval = { text: "", sources: [] };

/** How many pages an answer may draw on. More context is not a better answer. */
const MAX_PAGES = 8;
/** How many blocks are quoted from each page. */
const MAX_BLOCKS_PER_PAGE = 3;
/** Rows scored before ranking. Best matches come first, so this is a cost cap, not a filter. */
const MAX_SCORED_BLOCKS = 200;
/**
 * Below the server's 20k clip, so the bundle is not silently cut in half mid-source. The server
 * still truncates as a backstop, and reports it.
 */
const MAX_BUNDLE_CHARS = 18_000;

interface ScoredBlock {
  id: string;
  page_id: string;
  score: number;
}

/**
 * Find the pages that best answer a question, and quote the parts that matched.
 *
 * Returns nothing when the index is unavailable or no note matches — and the caller must then
 * NOT call the engine. Asking a model to answer from an empty bundle spends a request to be
 * told what the device already knew.
 */
export async function retrieveSources(workspaceId: string, question: string): Promise<Retrieval> {
  if (!isFtsReady()) return NOTHING_FOUND;

  const match = toOrQuery(extractTerms(question, 12));
  if (!match) return NOTHING_FOUND;

  let scored: ScoredBlock[];
  try {
    // `rank`, not `bm25(...)`: FTS5 refuses the auxiliary function outside a plain select.
    scored = await db.getAll<ScoredBlock>(
      `SELECT id, page_id, rank AS score
         FROM fts_blocks
        WHERE workspace_id = ? AND page_id IS NOT NULL AND fts_blocks MATCH ?
        ORDER BY rank LIMIT ?`,
      [workspaceId, match, MAX_SCORED_BLOCKS],
    );
  } catch (err) {
    console.error("Retrieval query failed", err);
    return NOTHING_FOUND;
  }
  if (scored.length === 0) return NOTHING_FOUND;

  // Best pages first, keeping each page's best blocks in rank order.
  const byPage = new Map<string, { score: number; blockIds: string[] }>();
  for (const row of scored) {
    const entry = byPage.get(row.page_id) ?? { score: 0, blockIds: [] };
    entry.score += row.score;
    if (entry.blockIds.length < MAX_BLOCKS_PER_PAGE) entry.blockIds.push(row.id);
    byPage.set(row.page_id, entry);
  }
  const pageIds = [...byPage.entries()]
    .sort((a, b) => a[1].score - b[1].score) // bm25: lower is better
    .slice(0, MAX_PAGES)
    .map(([id]) => id);

  const titles = new Map(
    (
      await db.getAll<{ id: string; title: string }>(
        `SELECT id, title FROM pages WHERE id IN (${pageIds.map(() => "?").join(", ")})`,
        pageIds,
      )
    ).map((row) => [row.id, row.title]),
  );

  const sources: Source[] = [];
  const parts: string[] = [];
  let used = 0;

  for (const pageId of pageIds) {
    if (!titles.has(pageId)) continue; // page deleted since it was indexed
    const wanted = byPage.get(pageId)?.blockIds ?? [];
    if (wanted.length === 0) continue;

    /*
     * Quote each matching block WITH the blocks either side of it. A bullet that matched often
     * means nothing without the line that introduced it, and a model handed orphan fragments
     * invents the connective tissue rather than admitting the notes do not say.
     */
    const rows = await db.getAll<{ id: string; content: string; position: number }>(
      `SELECT id, content, position FROM blocks
        WHERE page_id = ? AND position BETWEEN
              (SELECT min(position) - 1 FROM blocks WHERE id IN (${wanted.map(() => "?").join(", ")}))
          AND (SELECT max(position) + 1 FROM blocks WHERE id IN (${wanted.map(() => "?").join(", ")}))
        ORDER BY position`,
      [pageId, ...wanted, ...wanted],
    );

    const body = rows
      .map((row) => blockRowToText(row.content).trim())
      .filter((line) => line.length > 0)
      .join("\n");
    if (!body) continue;

    const number = sources.length + 1;
    const title = titles.get(pageId)?.trim() || "Untitled";
    const part = `[${number}] ${title}\n${body}`;
    if (used + part.length > MAX_BUNDLE_CHARS && sources.length > 0) break;

    parts.push(part);
    sources.push({ number, pageId, title });
    used += part.length + 2;
  }

  if (sources.length === 0) return NOTHING_FOUND;
  return { text: parts.join("\n\n").slice(0, MAX_BUNDLE_CHARS), sources };
}
