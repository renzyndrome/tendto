/**
 * Comment writes — all local, uploaded by the PowerSync connector. No network here.
 *
 * `author_id` and `workspace_id` are also pinned server-side on upload (sync.py), so what is
 * written here is a convenience for local rendering, never the authority: an editor cannot post
 * in someone else's name however the client is patched.
 */
import { db } from "../powersync/client";
import { sanitizeLabel } from "./mentions";

/** What a comment belongs to. Exactly one owner — the database enforces the XOR. */
export type CommentOwner = { kind: "page"; id: string } | { kind: "item"; id: string };

export interface CommentRow {
  id: string;
  workspace_id: string;
  page_id: string | null;
  item_id: string | null;
  author_id: string;
  author_label: string;
  body: string;
  /**
   * When the writing DEVICE recorded it — the thread's sort key and the timestamp shown.
   * Never `created_at`: that one is reserved, so the server stamps it when the row is uploaded,
   * and a comment written offline would read "just now" days later and sort after everything
   * said in between.
   */
  authored_at: string;
  edited_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Whether the author has edited this comment.
 *
 * Read from an explicit column rather than compared against `created_at`: the server stamps
 * `created_at` on upload while `updated_at` comes from the device, so the gap between them is a
 * measure of two different clocks — it hides a quick edit and invents ones that never happened.
 */
export function isEdited(row: CommentRow): boolean {
  return row.edited_at !== null;
}

export async function addComment(params: {
  owner: CommentOwner;
  workspaceId: string;
  authorId: string;
  authorLabel: string;
  body: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO comments
       (id, workspace_id, page_id, item_id, author_id, author_label, body, authored_at,
        edited_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    [
      id,
      params.workspaceId,
      params.owner.kind === "page" ? params.owner.id : null,
      params.owner.kind === "item" ? params.owner.id : null,
      params.authorId,
      // The server re-stamps this from better-auth on upload; what is written here is only
      // what THIS device shows until the row round-trips.
      sanitizeLabel(params.authorLabel),
      params.body,
      now,
      now,
      now,
    ],
  );
  return id;
}

export async function updateComment(id: string, body: string): Promise<void> {
  const now = new Date().toISOString();
  await db.execute("UPDATE comments SET body = ?, edited_at = ?, updated_at = ? WHERE id = ?", [
    body,
    now,
    now,
    id,
  ]);
}

export async function deleteComment(id: string): Promise<void> {
  await db.execute("DELETE FROM comments WHERE id = ?", [id]);
}
