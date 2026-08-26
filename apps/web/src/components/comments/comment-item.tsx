/**
 * One comment: who said it, when, and what — with mentions rendered as chips.
 *
 * A mention is highlighted and nothing more. No notification, no badge, no digest: being told
 * what a teammate did is the collaboration noise the product rules out (docs/planning/03
 * §guardrails). Seeing your own name stand out when you read the thread is the whole feature.
 */
import { useState } from "react";

import { exactTime, timeAgo } from "../../lib/comments/format";
import { parseBody } from "../../lib/comments/mentions";
import { deleteComment, isEdited, updateComment, type CommentRow } from "../../lib/comments/mutations";
import { CommentComposer } from "./comment-composer";

interface CommentItemProps {
  row: CommentRow;
  workspaceId: string;
  /** The signed-in user — decides whether this comment is editable, and which chip is "you". */
  currentUserId: string | null;
  /** Owners may delete anyone's comment (moderation); only the author may edit. */
  canModerate: boolean;
}

export function CommentItem({ row, workspaceId, currentUserId, canModerate }: CommentItemProps) {
  const [editing, setEditing] = useState(false);
  const isAuthor = currentUserId !== null && row.author_id === currentUserId;

  return (
    <li className="group py-2" data-testid="comment-row">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-medium text-fg">{row.author_label}</span>
        {/* authored_at, not created_at: the latter is stamped by the server on upload, so an
            offline comment would claim to have been written the moment it reconnected. */}
        <span className="text-[11px] text-subtle" title={exactTime(row.authored_at)}>
          {timeAgo(row.authored_at)}
        </span>
        {isEdited(row) ? <span className="text-[11px] text-subtle">(edited)</span> : null}

        {/* Affordances stay out of the way until you look at the comment. */}
        <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {isAuthor ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              data-testid="comment-edit"
              className="rounded px-1.5 py-0.5 text-[11px] text-subtle hover:text-fg"
            >
              Edit
            </button>
          ) : null}
          {isAuthor || canModerate ? (
            <button
              type="button"
              onClick={() => {
                if (!window.confirm("Delete this comment?")) return;
                void deleteComment(row.id);
              }}
              data-testid="comment-delete"
              className="rounded px-1.5 py-0.5 text-[11px] text-subtle hover:text-danger"
            >
              Delete
            </button>
          ) : null}
        </span>
      </div>

      {editing ? (
        <div className="mt-1.5">
          <CommentComposer
            workspaceId={workspaceId}
            initialValue={row.body}
            submitLabel="Save"
            autoFocus
            onSubmit={async (body) => {
              await updateComment(row.id, body);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-muted">
          {/* Segments are positional and re-derived whenever the body changes, so the index is
              the only identity they have — and the only one they need. */}
          {parseBody(row.body).map((segment, index) =>
            segment.kind === "text" ? (
              <span key={index}>{segment.text}</span>
            ) : (
              <span
                key={index}
                data-testid="comment-mention"
                data-you={segment.userId === currentUserId ? "true" : undefined}
                className={
                  segment.userId === currentUserId
                    ? "rounded bg-accent px-1 py-0.5 text-xs font-medium text-on-accent"
                    : "rounded bg-accent/10 px-1 py-0.5 text-xs font-medium text-accent"
                }
              >
                @{segment.label}
              </span>
            ),
          )}
        </p>
      )}
    </li>
  );
}
