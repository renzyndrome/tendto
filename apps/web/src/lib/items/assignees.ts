/**
 * Assignee options for a workspace.
 *
 * Members can't come from the replica: membership rows sync, but only as opaque better-auth
 * user ids — the readable email lives in better-auth's `user` table, which never syncs. So the
 * list is fetched once per workspace and cached here, rather than by every card that renders a
 * picker.
 *
 * The stored value stays a plain string (the member's email), exactly as when assignee was a
 * free-text field. That keeps existing items valid, keeps the value readable offline and in
 * exports, and means an unknown/legacy value can still be shown rather than silently dropped.
 */
import { fetchMembers } from "../members";

export interface AssigneeOption {
  value: string; // stored in properties.assignee
  label: string;
  isYou: boolean;
}

const cache = new Map<string, AssigneeOption[]>();
const inflight = new Map<string, Promise<AssigneeOption[]>>();

/** Cached member options. Returns [] when the API is unreachable — callers keep the raw value. */
export async function loadAssigneeOptions(workspaceId: string): Promise<AssigneeOption[]> {
  const cached = cache.get(workspaceId);
  if (cached) return cached;

  const pending = inflight.get(workspaceId);
  if (pending) return pending;

  const request = fetchMembers(workspaceId)
    .then((data) => {
      const options = data.members
        .map((member) => ({
          value: member.email ?? member.user_id,
          label: member.is_you ? `${member.email ?? member.user_id} (you)` : (member.email ?? member.user_id),
          isYou: member.is_you,
        }))
        // You first — in a solo workspace that's the only entry, and it's the common pick.
        .sort((a, b) => Number(b.isYou) - Number(a.isYou));
      cache.set(workspaceId, options);
      return options;
    })
    .catch(() => [] as AssigneeOption[])
    .finally(() => inflight.delete(workspaceId));

  inflight.set(workspaceId, request);
  return request;
}

/** Drop the cache after membership changes so pickers pick up the new list. */
export function invalidateAssignees(workspaceId?: string): void {
  if (workspaceId) cache.delete(workspaceId);
  else cache.clear();
}
