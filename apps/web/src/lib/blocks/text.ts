/**
 * Plain-text extraction from a block's stored `content` JSON.
 *
 * The editor persists each block as `JSON.stringify({ props, content, children })`, where
 * `content` is BlockNote's inline-content array (nodes like `{ type: "text", text, styles }`,
 * plus link nodes that nest their own `content`). Used by search (previews) and export
 * (markdown). This is an approximation — it ignores styling and non-text inline nodes.
 */

interface StoredBlockContent {
  props?: unknown;
  content?: unknown;
  children?: unknown;
}

interface InlineNode {
  text?: unknown;
  content?: unknown;
}

/** Concatenate the plain text of a BlockNote inline-content array (recursing into link nodes). */
export function inlineContentToText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const node of content) {
    if (node && typeof node === "object") {
      const inline = node as InlineNode;
      if (typeof inline.text === "string") out += inline.text;
      else if (Array.isArray(inline.content)) out += inlineContentToText(inline.content);
    }
  }
  return out;
}

export interface ParsedBlockContent {
  text: string;
  props: Record<string, unknown>;
}

/** Parse a block row's `content` column into its plain text and props bag (safe on garbage). */
export function parseBlockContent(contentJson: string): ParsedBlockContent {
  try {
    const parsed = JSON.parse(contentJson) as StoredBlockContent;
    const props =
      parsed.props && typeof parsed.props === "object"
        ? (parsed.props as Record<string, unknown>)
        : {};
    return { text: inlineContentToText(parsed.content), props };
  } catch {
    return { text: "", props: {} };
  }
}

/** Convenience: just the plain text of a block row's `content` column. */
export function blockRowToText(contentJson: string): string {
  return parseBlockContent(contentJson).text;
}
