/**
 * When a page was created, and when it was last edited.
 *
 * "Last edited" cannot be read off the page row. `renamePage` is the only thing that bumps
 * `pages.updated_at`; writing the body stamps the BLOCK rows and leaves the page untouched
 * (see `blocks/serialize.ts`). So the answer is the latest of the page row and its blocks —
 * which also means a page whose title was changed today still reports today, correctly.
 *
 * Every timestamp goes through `toInstant`. A replica column is not stable as TEXT: the same
 * moment reads as `2026-09-03T15:55:42.276Z` before a sync round-trip and
 * `2026-09-03 15:55:42.276+00` after it, and those two do not sort against each other.
 */
import { useQuery } from "@powersync/react";

import { toInstant } from "./blocks/self-writes";

export interface PageStamps {
  /** Epoch milliseconds, or null while the replica is still being read. */
  createdAt: number | null;
  editedAt: number | null;
}

const UNKNOWN: PageStamps = { createdAt: null, editedAt: null };

interface PageRow {
  created_at: string;
  updated_at: string;
}

interface BlockStamp {
  updated_at: string;
}

export function usePageStamps(pageId: string): PageStamps {
  const { data: pages, isLoading: pageLoading } = useQuery<PageRow>(
    "SELECT created_at, updated_at FROM pages WHERE id = ?",
    [pageId],
  );
  const { data: blocks, isLoading: blocksLoading } = useQuery<BlockStamp>(
    "SELECT updated_at FROM blocks WHERE page_id = ?",
    [pageId],
  );

  // An empty array is what the hook reports while it is still loading, so the loading flags
  // decide — not the row count. Same trap as `useExternalEdit`.
  if (pageLoading || blocksLoading) return UNKNOWN;

  const page = pages[0];
  if (!page) return UNKNOWN;

  const createdAt = toInstant(page.created_at);
  let editedAt = toInstant(page.updated_at);
  for (const block of blocks) {
    const at = toInstant(block.updated_at);
    if (at > editedAt) editedAt = at;
  }

  return {
    createdAt: Number.isNaN(createdAt) ? null : createdAt,
    editedAt: Number.isNaN(editedAt) ? null : editedAt,
  };
}
