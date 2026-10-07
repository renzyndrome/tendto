/**
 * Page lookup for the `[[` link menu.
 *
 * Reads the local replica only — the menu opens mid-keystroke, so it must never wait on the
 * network. Ranked by FTS5 when the index is up (the same index search uses), with the LIKE
 * scan as the fallback, exactly as `../search.ts` does it.
 */
import { db } from "../powersync/client";
import { isFtsReady, toPrefixQuery } from "../powersync/fts";

/** One row in the `[[` menu. */
export interface PageChoice {
  id: string;
  title: string;
}

const LIMIT = 8;

function escapeLike(input: string): string {
  return input.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

/**
 * Pages the user can link to. An empty query lists the most recently touched pages, so that
 * typing `[[` alone is already useful; a non-empty one is a prefix search over titles.
 * The page being edited is excluded — a page linking to itself is never what was meant.
 */
export async function findPagesForLink(
  workspaceId: string,
  query: string,
  excludePageId: string | null,
): Promise<PageChoice[]> {
  const trimmed = query.trim();
  const exclude = excludePageId ?? "";

  if (!trimmed) {
    return db.getAll<PageChoice>(
      "SELECT id, title FROM pages WHERE workspace_id = ? AND id != ? " +
        "ORDER BY updated_at DESC LIMIT ?",
      [workspaceId, exclude, LIMIT],
    );
  }

  if (isFtsReady()) {
    const match = toPrefixQuery(trimmed);
    if (match) {
      try {
        return await db.getAll<PageChoice>(
          "SELECT id, title FROM fts_pages WHERE workspace_id = ? AND id != ? " +
            "AND fts_pages MATCH ? ORDER BY rank LIMIT ?",
          [workspaceId, exclude, match, LIMIT],
        );
      } catch (err) {
        // A malformed FTS expression must not leave the menu empty.
        console.error("FTS page lookup failed; falling back to LIKE scan", err);
      }
    }
  }

  return db.getAll<PageChoice>(
    "SELECT id, title FROM pages WHERE workspace_id = ? AND id != ? " +
      "AND title LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?",
    [workspaceId, exclude, `%${escapeLike(trimmed)}%`, LIMIT],
  );
}
