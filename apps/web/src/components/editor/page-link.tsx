/**
 * `pageLink` — a page-to-page link, as BlockNote INLINE CONTENT rather than a block.
 *
 * A block type would fight the curated block set (docs/planning 03: "resist adding more"); a
 * link belongs inside a sentence anyway. The node stores `{ pageId, title }`, but the chip
 * renders the LIVE title from the replica, so renaming the target updates every link to it
 * without rewriting a single block. The stored `title` is only a snapshot: it keeps the link
 * readable in export and in the search index, and it is what shows if the row is not here yet.
 *
 * Never call `updateInlineContent` to refresh that snapshot on render — it would dirty the
 * document on every device that merely OPENS the page, and last-write-wins would then churn
 * the same blocks between devices forever.
 */
import { createReactInlineContentSpec } from "@blocknote/react";
import { useQuery } from "@powersync/react";


export const PAGE_LINK_TYPE = "pageLink";

/**
 * Marks the clickable chip for the editor-level click handler in `block-editor.tsx`.
 *
 * The handler lives there, not here, because BlockNote renders an inline node view through its
 * own React root and moves the resulting DOM into the editor: React's event delegation stays
 * bound to the container it rendered into, so neither a synthetic `onClick` nor a listener
 * attached in an effect on this node reliably fires once a document has been hydrated from
 * stored blocks. One listener on the editor container sees every click, however the chip got
 * there.
 */
export const PAGE_LINK_ATTR = "data-page-link";

/** The props a stored `pageLink` node carries. */
export interface PageLinkProps {
  pageId: string;
  title: string;
}

/**
 * The chip as it appears in the editor. Resolves the target's current title; a target that is
 * gone renders muted and does NOT navigate — opening an unknown page id renders an empty
 * editor, and typing there would insert blocks whose `page_id` Postgres no longer has, which
 * fails the upload and wedges this device's ordered queue.
 */
function PageLinkChip(props: {
  inlineContent: { props: PageLinkProps };
}) {
  const { pageId, title } = props.inlineContent.props;
  const { data, isLoading } = useQuery<{ title: string }>(
    "SELECT title FROM pages WHERE id = ?",
    [pageId],
  );
  /*
   * `isLoading` is load-bearing, not decoration. The hook reports an EMPTY ARRAY before its
   * first result arrives, which is indistinguishable from "there is no such page" — so a chip
   * that only checked the length rendered as a dead, struck-through link every time the
   * document was hydrated from stored blocks, and stayed unclickable.
   */
  const missing = !isLoading && data.length === 0;
  const liveTitle = data[0]?.title;
  const label = (liveTitle ?? title ?? "").trim() || "Untitled";

  if (missing) {
    return (
      <span
        contentEditable={false}
        data-testid="page-link"
        data-page-id={pageId}
        data-missing="true"
        title="This page was deleted"
        className="rounded bg-hover/40 px-1 py-0.5 text-subtle line-through decoration-subtle"
      >
        {label}
      </span>
    );
  }

  return (
    <span
      // Behave like a link, not like text: the caret must never land inside the chip. The
      // click itself is handled once, on the editor container — see PAGE_LINK_ATTR.
      contentEditable={false}
      data-testid="page-link"
      data-page-id={pageId}
      {...{ [PAGE_LINK_ATTR]: pageId }}
      role="link"
      tabIndex={0}
      title={`Open ${label}`}
      /* `accent` is the same shade as body text in both themes (it is the button fill), so
         the chip is set apart by its pill and its underline rather than by colour — which also
         keeps it legible for anyone who cannot rely on hue. */
      className="cursor-pointer rounded bg-hover/60 px-1 py-0.5 font-medium text-fg underline decoration-subtle underline-offset-2 hover:bg-hover hover:decoration-fg"
    >
      {label}
    </span>
  );
}

/**
 * How the node serializes for export and for `blocksToMarkdownLossy` (which is what the AI
 * "Summarize" button sends). This runs SYNCHRONOUSLY inside the exporter, outside React's
 * normal render loop, so it must not query the replica — the snapshot title is all it has.
 */
function PageLinkExternal(props: { inlineContent: { props: PageLinkProps } }) {
  const { title } = props.inlineContent.props;
  return <span>{title || "Untitled"}</span>;
}

export const pageLink = createReactInlineContentSpec(
  {
    type: PAGE_LINK_TYPE,
    propSchema: {
      pageId: { default: "" },
      title: { default: "" },
    },
    content: "none",
  } as const,
  {
    render: PageLinkChip,
    toExternalHTML: PageLinkExternal,
  },
);
