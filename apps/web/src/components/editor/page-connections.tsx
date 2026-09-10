/**
 * What points at this page — backlinks, then unlinked mentions.
 *
 * Sits between the page body and its comments, and renders NOTHING at all when there is nothing
 * to say, which is the common case. When there is, it is one quiet line the reader can open; a
 * panel that is always expanded turns every page into a page about its own metadata.
 */
import { useState } from "react";

import { usePageConnections } from "../../lib/links/use-page-connections";
import type { Backlink } from "../../lib/links/backlinks";
import type { RelatedPage } from "../../lib/links/related";
import { router } from "../../routes/router";

interface PageConnectionsProps {
  workspaceId: string | null;
  pageId: string;
}

export function PageConnections({ workspaceId, pageId }: PageConnectionsProps) {
  const { backlinks, mentions, related } = usePageConnections(workspaceId, pageId);
  const [open, setOpen] = useState(false);

  const total = backlinks.length + mentions.length + related.length;
  if (total === 0) return null;

  const summary = [
    backlinks.length > 0 ? `${backlinks.length} linked` : null,
    mentions.length > 0 ? `${mentions.length} mentioned` : null,
    related.length > 0 ? `${related.length} related` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="mt-10 border-t border-line pt-5" data-testid="page-connections">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        data-testid="connections-toggle"
        className="flex items-center gap-2 text-xs text-subtle hover:text-fg"
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        {summary}
      </button>

      {open ? (
        <div className="mt-3 space-y-4">
          {/* Two lists, not one: a link is a decision someone made, a mention is only a
              hint that they might have meant to. */}
          <Group label="Linked from" testid="backlink-row" rows={backlinks} />
          <Group label="Mentioned in" testid="mention-row" rows={mentions} />
          {/* Nobody connected these; the words did. Last, because it is the softest signal. */}
          <Group label="Related" testid="related-row" rows={related} />
        </div>
      ) : null}
    </section>
  );
}

interface GroupProps {
  label: string;
  testid: string;
  rows: (Backlink | RelatedPage)[];
}

function Group({ label, testid, rows }: GroupProps) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-subtle">{label}</h4>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.pageId}>
            <button
              type="button"
              data-testid={testid}
              onClick={() =>
                void router.navigate({ to: "/p/$pageId", params: { pageId: row.pageId } })
              }
              className="w-full rounded px-2 py-1.5 text-left hover:bg-hover"
            >
              <span className="block truncate text-sm text-fg">{row.title}</span>
              {"snippet" in row && row.snippet ? (
                <span className="block truncate text-xs text-subtle">{row.snippet}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
