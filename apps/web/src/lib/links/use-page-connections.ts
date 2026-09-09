/**
 * Keeps a page's backlinks and unlinked mentions current.
 *
 * Deliberately NOT `useQuery`. PowerSync resolves the tables a watched query depends on from the
 * statement's read plan, and neither of these can be watched that way: `page_links` is a plain
 * local table written by triggers rather than by the sync stream, and `fts_blocks` is an FTS5
 * virtual table with no root page for the planner to report. Both are only ever changed as a
 * side effect of a write to `blocks` or `pages`, so that is what this subscribes to.
 */
import { useEffect, useState } from "react";

import { db } from "../powersync/client";
import { backlinksFor, unlinkedMentionsFor, type Backlink } from "./backlinks";

export interface PageConnections {
  backlinks: Backlink[];
  mentions: Backlink[];
}

const EMPTY: PageConnections = { backlinks: [], mentions: [] };

/** Coalesce bursts of edits: typing writes a block every half-second. */
const THROTTLE_MS = 1000;

export function usePageConnections(workspaceId: string | null, pageId: string): PageConnections {
  const [connections, setConnections] = useState<PageConnections>(EMPTY);

  useEffect(() => {
    if (!workspaceId) {
      setConnections(EMPTY);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;

    const refresh = async () => {
      // The title is read here rather than passed in, because it is what unlinked mentions are
      // searched for: renaming the page must change the answer, and this already re-runs on any
      // `pages` write.
      const rows = await db.getAll<{ title: string }>("SELECT title FROM pages WHERE id = ?", [
        pageId,
      ]);
      const title = rows[0]?.title ?? "";
      const [backlinks, mentions] = await Promise.all([
        backlinksFor(workspaceId, pageId),
        unlinkedMentionsFor(workspaceId, pageId, title),
      ]);
      if (!cancelled) setConnections({ backlinks, mentions });
    };

    db.onChange(
      { onChange: () => void refresh().catch(() => undefined) },
      { tables: ["blocks", "pages"], throttleMs: THROTTLE_MS, signal: controller.signal },
    );
    void refresh().catch(() => undefined);

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [workspaceId, pageId]);

  return connections;
}
