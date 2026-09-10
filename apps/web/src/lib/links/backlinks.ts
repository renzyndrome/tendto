/**
 * Backlinks and unlinked mentions — "what points at this page?"
 *
 * Two questions, deliberately kept apart because they answer different things. A BACKLINK is a
 * real `[[` link somebody made, read from the local `page_links` index. An UNLINKED MENTION is
 * this page's title written out as ordinary prose somewhere else, found with a full-text phrase
 * search. Obsidian separates them for the same reason: one is a decision, the other is a hint.
 */
import { blockRowToText } from "../blocks/text";
import { db } from "../powersync/client";
import { isFtsReady, toPhraseQuery } from "../powersync/fts";
import { isPageLinksReady } from "../powersync/page-links";

/** A page that points here, with a line of context from where it does. */
export interface Backlink {
  pageId: string;
  title: string;
  snippet: string;
}

/** How much of the linking paragraph to show. Long enough to place it, short enough to skim. */
const SNIPPET_CHARS = 160;
const MAX_ROWS = 20;
/** Below this a title is too generic to hunt for in prose ("Q3", "Me"). */
const MIN_MENTION_TITLE = 3;

function snippetOf(content: string): string {
  const text = blockRowToText(content).replace(/\s+/g, " ").trim();
  return text.length > SNIPPET_CHARS ? `${text.slice(0, SNIPPET_CHARS).trimEnd()}…` : text;
}

/**
 * Pages that link to `pageId`, one entry per source page, each with the text of the block the
 * link sits in. A page that links here several times is listed once: the panel answers "who
 * points at this?", not "how often".
 */
export async function backlinksFor(workspaceId: string, pageId: string): Promise<Backlink[]> {
  if (!isPageLinksReady()) return [];

  const rows = await db.getAll<{ source_page_id: string; title: string; content: string }>(
    `SELECT l.source_page_id, p.title AS title, b.content AS content
       FROM page_links l
       JOIN pages p ON p.id = l.source_page_id
       LEFT JOIN blocks b ON b.id = l.block_id
      WHERE l.target_page_id = ? AND l.workspace_id = ? AND l.source_page_id != ?
      ORDER BY p.title, b.position
      LIMIT ?`,
    [pageId, workspaceId, pageId, MAX_ROWS * 4],
  );

  const seen = new Map<string, Backlink>();
  for (const row of rows) {
    if (seen.has(row.source_page_id)) continue;
    seen.set(row.source_page_id, {
      pageId: row.source_page_id,
      title: row.title?.trim() || "Untitled",
      snippet: snippetOf(row.content ?? ""),
    });
    if (seen.size >= MAX_ROWS) break;
  }
  return [...seen.values()];
}

/**
 * Pages whose text contains this page's title but which do NOT link to it — the "you wrote about
 * this before you had a page for it" case.
 *
 * Pages that already link here are excluded, so a mention never duplicates a backlink. An empty
 * or generic title is skipped rather than matching half the workspace, and the whole thing needs
 * the FTS index: a LIKE scan for a phrase across every block is exactly the slow path search was
 * built to retire.
 */
export async function unlinkedMentionsFor(
  workspaceId: string,
  pageId: string,
  title: string,
): Promise<Backlink[]> {
  const trimmed = title.trim();
  if (!isFtsReady() || trimmed.length < MIN_MENTION_TITLE || trimmed === "Untitled") return [];

  const match = toPhraseQuery(trimmed);
  if (!match) return [];

  const linked = isPageLinksReady()
    ? await db.getAll<{ source_page_id: string }>(
        "SELECT DISTINCT source_page_id FROM page_links WHERE target_page_id = ?",
        [pageId],
      )
    : [];
  const exclude = new Set([pageId, ...linked.map((row) => row.source_page_id)]);

  let rows: { page_id: string; body: string }[];
  try {
    rows = await db.getAll<{ page_id: string; body: string }>(
      `SELECT page_id, body FROM fts_blocks
        WHERE workspace_id = ? AND page_id IS NOT NULL AND fts_blocks MATCH ?
        ORDER BY rank LIMIT ?`,
      [workspaceId, match, MAX_ROWS * 4],
    );
  } catch (err) {
    // A title that is somehow still not a valid FTS phrase must not break the panel.
    console.error("Unlinked-mention search failed", err);
    return [];
  }

  const candidates = rows.filter((row) => !exclude.has(row.page_id));
  if (candidates.length === 0) return [];

  const titles = new Map(
    (
      await db.getAll<{ id: string; title: string }>(
        `SELECT id, title FROM pages WHERE id IN (${candidates.map(() => "?").join(", ")})`,
        candidates.map((row) => row.page_id),
      )
    ).map((row) => [row.id, row.title]),
  );

  const seen = new Map<string, Backlink>();
  for (const row of candidates) {
    if (seen.has(row.page_id) || !titles.has(row.page_id)) continue;
    seen.set(row.page_id, {
      pageId: row.page_id,
      title: titles.get(row.page_id)?.trim() || "Untitled",
      snippet: row.body.replace(/\s+/g, " ").trim().slice(0, SNIPPET_CHARS),
    });
    if (seen.size >= MAX_ROWS) break;
  }
  return [...seen.values()];
}
