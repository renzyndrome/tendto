/**
 * The comment thread under a page or a card.
 *
 * One flat stream, oldest first — a conversation reads top to bottom. No threads and no resolve
 * state in v1: both are structure you have to maintain, and a team small enough to fit in one
 * workspace usually just reads the last few lines.
 *
 * Everything here is a replica query, so the thread is instant and works offline; writes queue
 * and upload like any other row. Role is read from the local `memberships` table rather than the
 * members API, so a viewer still sees the right (read-only) UI with no network.
 */
import { useQuery } from "@powersync/react";

import { useSession } from "../../lib/auth/client";
import { addComment, type CommentOwner, type CommentRow } from "../../lib/comments/mutations";
import { CommentComposer } from "./comment-composer";
import { CommentItem } from "./comment-item";

interface CommentSectionProps {
  owner: CommentOwner;
  workspaceId: string | null;
}

interface RoleRow {
  role: string;
}

export function CommentSection({ owner, workspaceId }: CommentSectionProps) {
  const { data: session } = useSession();
  const currentUserId = session?.user?.id ?? null;
  // The label a new comment is stamped with. Server-side only `author_id` is trusted; this is
  // what other devices display, since better-auth's user table never syncs.
  const authorLabel = session?.user?.name?.trim() || session?.user?.email || currentUserId || "";

  const column = owner.kind === "page" ? "page_id" : "item_id";
  // Ordered by authored_at (the writing device's clock), never created_at (the server's, stamped
  // at upload) — otherwise a comment written offline would land at the bottom of the thread days
  // after the conversation moved on. `id` only breaks ties.
  const { data: comments } = useQuery<CommentRow>(
    `SELECT * FROM comments WHERE ${column} = ? ORDER BY authored_at ASC, id ASC`,
    [owner.id],
  );

  // Commenting rides the same write roles as everything else: a viewer reads the thread but
  // cannot post (a dedicated `commenter` role is a later, deliberate decision).
  const { data: roles } = useQuery<RoleRow>(
    "SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?",
    [workspaceId ?? "", currentUserId ?? ""],
  );
  const role = roles?.[0]?.role ?? null;
  const canWrite = role === "owner" || role === "editor";

  return (
    <section data-testid="comment-section">
      <h3 className="mb-1.5 text-xs text-subtle">
        Comments
        {comments.length > 0 ? <span className="text-subtle"> · {comments.length}</span> : null}
      </h3>

      {comments.length > 0 ? (
        <ul className="mb-2 divide-y divide-line">
          {comments.map((row) => (
            <CommentItem
              key={row.id}
              row={row}
              workspaceId={row.workspace_id}
              currentUserId={currentUserId}
              canModerate={role === "owner"}
            />
          ))}
        </ul>
      ) : null}

      {canWrite && workspaceId !== null && currentUserId !== null ? (
        <CommentComposer
          workspaceId={workspaceId}
          submitLabel="Comment"
          onSubmit={async (body) => {
            await addComment({ owner, workspaceId, authorId: currentUserId, authorLabel, body });
          }}
        />
      ) : comments.length === 0 ? (
        <p className="text-sm text-subtle">No comments yet.</p>
      ) : null}
    </section>
  );
}
