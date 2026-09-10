/**
 * Plain-text extraction from a block's stored `content` JSON.
 *
 * The editor persists each block as `JSON.stringify({ props, content, children })`, where
 * `content` is BlockNote's inline-content array (nodes like `{ type: "text", text, styles }`,
 * plus link nodes that nest their own `content`, plus our `pageLink` nodes which carry their
 * label in `props.title`). Used by search (previews) and export (markdown). This is an
 * approximation — it ignores styling and non-text inline nodes.
 *
 * Keep this in step with its SQL twin, `blockTextSql()` in ../powersync/fts.ts: the two must
 * agree on what a block's text IS, or search finds words that previews cannot show.
 */

interface StoredBlockContent {
  props?: unknown;
  content?: unknown;
  children?: unknown;
}

interface InlineNode {
  type?: unknown;
  text?: unknown;
  content?: unknown;
  props?: unknown;
}

/** How to render non-text inline nodes. Defaults to a `pageLink`'s stored title. */
export interface InlineRenderers {
  pageLink?: (props: { pageId: string; title: string }) => string;
}

/** A `pageLink` node's props, if this really is one. */
function pageLinkProps(node: InlineNode): { pageId: string; title: string } | null {
  if (node.type !== "pageLink" || !node.props || typeof node.props !== "object") return null;
  const props = node.props as { pageId?: unknown; title?: unknown };
  if (typeof props.pageId !== "string") return null;
  return { pageId: props.pageId, title: typeof props.title === "string" ? props.title : "" };
}

/** Concatenate the plain text of a BlockNote inline-content array (recursing into link nodes). */
export function inlineContentToText(content: unknown, renderers?: InlineRenderers): string {
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const node of content) {
    if (node && typeof node === "object") {
      const inline = node as InlineNode;
      const link = pageLinkProps(inline);
      if (link) out += renderers?.pageLink?.(link) ?? link.title;
      else if (typeof inline.text === "string") out += inline.text;
      else if (Array.isArray(inline.content)) out += inlineContentToText(inline.content, renderers);
    }
  }
  return out;
}

export interface ParsedBlockContent {
  text: string;
  props: Record<string, unknown>;
}

/** Parse a block row's `content` column into its plain text and props bag (safe on garbage). */
export function parseBlockContent(
  contentJson: string,
  renderers?: InlineRenderers,
): ParsedBlockContent {
  try {
    const parsed = JSON.parse(contentJson) as StoredBlockContent;
    const props =
      parsed.props && typeof parsed.props === "object"
        ? (parsed.props as Record<string, unknown>)
        : {};
    return { text: inlineContentToText(parsed.content, renderers), props };
  } catch {
    return { text: "", props: {} };
  }
}

/** Convenience: just the plain text of a block row's `content` column. */
export function blockRowToText(contentJson: string, renderers?: InlineRenderers): string {
  return parseBlockContent(contentJson, renderers).text;
}
