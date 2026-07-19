/** Shared item meta renderers used across board / table / list: a due-date label and a stack of
 *  assignee avatars resolved from workspace members. Keeps the four views visually consistent. */
import { memberInitials, memberLabel, type MemberInfo } from "../../../lib/workspaces";
import type { WorkspaceMembers } from "../../../stores/members";

/** Format an ISO date (YYYY-MM-DD) as a short "Mon D" label; fall back to the raw value. */
export function formatDue(due: string): string {
  const parsed = new Date(`${due}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return due;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** A due date is "overdue" once it is today or earlier (tinted terracotta). */
export function isOverdue(due: string): boolean {
  const parsed = new Date(`${due}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return parsed.getTime() <= today.getTime();
}

export function DueLabel({ due, className = "" }: { due: string; className?: string }) {
  return (
    <span className={"text-[10.5px] " + (isOverdue(due) ? "text-overdue" : "text-faint") + " " + className}>
      {formatDue(due)}
    </span>
  );
}

/** A compact stack of assignee avatars (initials), resolved from workspace members. */
export function AssigneeAvatars({
  assignees,
  members,
  max = 3,
  size = 20,
}: {
  assignees: string[] | undefined;
  members: WorkspaceMembers;
  max?: number;
  size?: number;
}) {
  // Fall back to an id-only stub so the avatar still renders (with id initials) before members
  // load or when offline.
  const resolved: MemberInfo[] = (assignees ?? []).map(
    (id) => members.byId.get(id) ?? { user_id: id, role: "" },
  );
  if (resolved.length === 0) return null;

  const shown = resolved.slice(0, max);
  const extra = resolved.length - shown.length;
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((m) => (
        <span
          key={m.user_id}
          title={memberLabel(m)}
          style={{ width: size, height: size }}
          className="flex items-center justify-center rounded-full border border-surface bg-accent text-[9px] font-semibold text-accent-contrast"
        >
          {memberInitials(m)}
        </span>
      ))}
      {extra > 0 ? (
        <span
          style={{ width: size, height: size }}
          className="flex items-center justify-center rounded-full border border-surface bg-chip text-[9px] font-semibold text-secondary"
        >
          +{extra}
        </span>
      ) : null}
    </div>
  );
}
