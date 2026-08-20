/**
 * @mention encoding — inline tokens inside the comment body.
 *
 * A mention is stored in the text itself as `@[<user_id>:<label>]` rather than as a separate
 * table of offsets. Two reasons: the token moves with the text when the comment is edited (an
 * offset list goes stale the moment a character is inserted before it), and the label travels
 * with the row, so a comment renders on a device that has never fetched the member roster —
 * user records live in better-auth and never sync.
 *
 * Pure functions only: no data access, no React. Same split as `lib/calendar.ts`.
 */

/** One piece of a parsed body: literal text, or a resolved mention. */
export type BodySegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; userId: string; label: string };

// `[^:\][]+` for the id half stops the split from being ambiguous when a label contains a colon
// (an email never has one, but a display name might). The label half forbids brackets only.
const MENTION_RE = /@\[([^:\][]+):([^\][]+)\]/g;

/** Matches `comments.author_label` / the mention label's column width on the server. */
const MAX_LABEL = 320;

/**
 * Strip the characters that would break a token out of a display label, and cap its length.
 *
 * Labels are user-controlled (a better-auth display name), so they are sanitized once at write
 * time rather than escaped at read time — a token that cannot be malformed cannot be misparsed.
 * The cap matters for the same reason the parse in sync.py does: an over-long value is rejected
 * by Postgres, and a rejected upload wedges the device's ordered queue.
 */
export function sanitizeLabel(label: string): string {
  return label.replace(/[[\]]/g, "").trim().slice(0, MAX_LABEL);
}

/** Build the inline token for a member. */
export function encodeMention(userId: string, label: string): string {
  return `@[${userId}:${sanitizeLabel(label)}]`;
}

/**
 * Split a body into text and mention segments, in order.
 *
 * Anything that isn't a well-formed token stays literal text, so a comment that merely talks
 * about `@[` renders as typed rather than disappearing.
 */
export function parseBody(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  let cursor = 0;
  // A fresh regex per call: MENTION_RE is global, and sharing lastIndex across calls would make
  // parsing depend on what was parsed before it.
  const re = new RegExp(MENTION_RE.source, "g");
  let match = re.exec(body);
  while (match !== null) {
    if (match.index > cursor) {
      segments.push({ kind: "text", text: body.slice(cursor, match.index) });
    }
    segments.push({ kind: "mention", userId: match[1], label: match[2] });
    cursor = match.index + match[0].length;
    match = re.exec(body);
  }
  if (cursor < body.length) {
    segments.push({ kind: "text", text: body.slice(cursor) });
  }
  return segments;
}

/** The user ids mentioned in a body (deduplicated, in order of first appearance). */
export function mentionedUserIds(body: string): string[] {
  const ids = parseBody(body)
    .filter((segment): segment is Extract<BodySegment, { kind: "mention" }> => segment.kind === "mention")
    .map((segment) => segment.userId);
  return [...new Set(ids)];
}

/**
 * The in-progress `@query` immediately before the caret, or null.
 *
 * Only fires at a word boundary, so an email address typed into a comment doesn't open the
 * picker. The query stops at whitespace: mentions are picked from a list, not typed out in full.
 */
export function activeMentionQuery(
  text: string,
  caret: number,
): { query: string; start: number } | null {
  const upToCaret = text.slice(0, caret);
  const at = upToCaret.lastIndexOf("@");
  if (at === -1) return null;
  const before = at === 0 ? "" : upToCaret[at - 1];
  if (before !== "" && !/\s/.test(before)) return null;
  const query = upToCaret.slice(at + 1);
  if (/[\s[\]]/.test(query)) return null;
  return { query, start: at };
}

/** Replace the active `@query` with a finished token, returning the new text and caret. */
export function insertMention(
  text: string,
  range: { query: string; start: number },
  userId: string,
  label: string,
): { text: string; caret: number } {
  const token = `${encodeMention(userId, label)} `;
  const head = text.slice(0, range.start);
  const tail = text.slice(range.start + 1 + range.query.length);
  return { text: `${head}${token}${tail}`, caret: head.length + token.length };
}
