/**
 * Related pages — "what else is about this?", computed on the device for nothing.
 *
 * The distinctive words of the open page are turned into an FTS5 "match any of these" query, and
 * other pages are ranked by how well their text answers it. That is a poor cousin of an
 * embedding, and it is chosen deliberately: semantic search needs a paid embeddings API that the
 * self-hosted setup cannot provide, and the full-text index is already on the device. Everything
 * here runs offline and costs nothing per query.
 *
 * `relatedPages` is exported through an interface so a future embedding implementation can
 * replace this one without the panel knowing.
 */
import { db } from "../powersync/client";
import { isFtsReady, toOrQuery } from "../powersync/fts";
import { extractTerms } from "./terms";

export interface RelatedPage {
  pageId: string;
  title: string;
}

export interface RelatedPagesProvider {
  related(
    workspaceId: string,
    pageId: string,
    excludeIds: readonly string[],
  ): Promise<RelatedPage[]>;
}

/** Few enough to read at a glance; more would be a search result, not a suggestion. */
const MAX_RELATED = 5;
/** How many terms describe the open page. Beyond this the query drifts off its subject. */
const MAX_TERMS = 12;
/** How much of the page to read when picking those terms. */
const MAX_SOURCE_BLOCKS = 60;
/**
 * A title match counts for more than a body match: a page NAMED "Budget" is more about budgets
 * than one that mentions the word twice. bm25 returns lower-is-better, so a bonus is subtracted.
 */
const TITLE_BONUS = 4;
/** Caps on how much of a big workspace is scored. Best-matching rows come first either way. */
const MAX_SCORED_BLOCKS = 200;
const MAX_SCORED_TITLES = 50;

/** The words that describe a page: its title plus the text of its blocks. */
async function describePage(workspaceId: string, pageId: string): Promise<string[]> {
  const [pages, blocks] = await Promise.all([
    db.getAll<{ title: string }>("SELECT title FROM pages WHERE id = ?", [pageId]),
    db.getAll<{ body: string }>(
      "SELECT body FROM fts_blocks WHERE workspace_id = ? AND page_id = ? LIMIT ?",
      [workspaceId, pageId, MAX_SOURCE_BLOCKS],
    ),
  ]);
  const text = [pages[0]?.title ?? "", ...blocks.map((row) => row.body)].join(" ");
  return extractTerms(text, MAX_TERMS);
}

const ftsRelatedPages: RelatedPagesProvider = {
  async related(workspaceId, pageId, excludeIds) {
    if (!isFtsReady()) return [];

    const terms = await describePage(workspaceId, pageId);
    const match = toOrQuery(terms);
    if (!match) return [];

    let bodyRows: { page_id: string; score: number }[] = [];
    let titleRows: { id: string; score: number }[] = [];
    try {
      /*
       * `rank` rather than `bm25(...)`, and the per-page totals are summed in JavaScript rather
       * than by SQL. FTS5 refuses to evaluate an auxiliary function such as bm25() in an
       * aggregate context, and wraps that refusal around a subquery too, so a GROUP BY here
       * fails outright with "unable to use function bm25 in the requested context". `rank` is
       * the same bm25 score by another name, and it may be selected.
       */
      [bodyRows, titleRows] = await Promise.all([
        db.getAll<{ page_id: string; score: number }>(
          `SELECT page_id, rank AS score
             FROM fts_blocks
            WHERE workspace_id = ? AND page_id IS NOT NULL AND page_id != ?
              AND fts_blocks MATCH ?
            ORDER BY rank LIMIT ?`,
          [workspaceId, pageId, match, MAX_SCORED_BLOCKS],
        ),
        db.getAll<{ id: string; score: number }>(
          `SELECT id, rank AS score
             FROM fts_pages
            WHERE workspace_id = ? AND id != ? AND fts_pages MATCH ?
            ORDER BY rank LIMIT ?`,
          [workspaceId, pageId, match, MAX_SCORED_TITLES],
        ),
      ]);
    } catch (err) {
      // A term that is somehow not a valid FTS token must not take the panel down with it.
      console.error("Related-pages query failed", err);
      return [];
    }

    const scores = new Map<string, number>();
    for (const row of bodyRows) {
      scores.set(row.page_id, (scores.get(row.page_id) ?? 0) + row.score);
    }
    for (const row of titleRows) {
      scores.set(row.id, (scores.get(row.id) ?? 0) + row.score - TITLE_BONUS);
    }

    const excluded = new Set([pageId, ...excludeIds]);
    const ranked = [...scores.entries()]
      .filter(([id]) => !excluded.has(id))
      .sort((a, b) => a[1] - b[1]) // bm25: lower is a better match
      .slice(0, MAX_RELATED)
      .map(([id]) => id);
    if (ranked.length === 0) return [];

    const titles = await db.getAll<{ id: string; title: string }>(
      `SELECT id, title FROM pages WHERE id IN (${ranked.map(() => "?").join(", ")})`,
      ranked,
    );
    const byId = new Map(titles.map((row) => [row.id, row.title]));

    // Re-sorted back into rank order: the IN clause returns rows in whatever order it likes.
    return ranked
      .filter((id) => byId.has(id))
      .map((id) => ({ pageId: id, title: byId.get(id)?.trim() || "Untitled" }));
  },
};

/** The swap point: replace this binding to move related pages onto embeddings later. */
export const relatedPages: RelatedPagesProvider = ftsRelatedPages;
