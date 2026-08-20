/**
 * The members you can @mention in a workspace.
 *
 * Same shape and same reason as `lib/items/assignees.ts` — membership rows sync but carry only
 * opaque better-auth user ids, so the readable name comes from the API and is cached per
 * workspace. The difference is what's kept: a mention needs the USER ID (it is the durable half
 * of the token; the label is only what gets displayed), whereas an assignee stores the email.
 *
 * Offline this resolves to an empty list, so the picker simply never opens — typing `@someone`
 * stays plain text rather than failing.
 */
import { fetchMembers } from "../members";

export interface MentionCandidate {
  userId: string;
  label: string;
  isYou: boolean;
}

const cache = new Map<string, MentionCandidate[]>();
const inflight = new Map<string, Promise<MentionCandidate[]>>();

export async function loadMentionRoster(workspaceId: string): Promise<MentionCandidate[]> {
  const cached = cache.get(workspaceId);
  if (cached) return cached;

  const pending = inflight.get(workspaceId);
  if (pending) return pending;

  const request = fetchMembers(workspaceId)
    .then((data) => {
      const roster = data.members.map((member) => ({
        userId: member.user_id,
        label: member.name?.trim() || member.email || member.user_id,
        isYou: member.is_you,
      }));
      cache.set(workspaceId, roster);
      return roster;
    })
    .catch(() => [] as MentionCandidate[])
    .finally(() => inflight.delete(workspaceId));

  inflight.set(workspaceId, request);
  return request;
}

/** Drop the cache after membership changes, so a new teammate becomes mentionable. */
export function invalidateMentionRoster(workspaceId?: string): void {
  if (workspaceId) cache.delete(workspaceId);
  else cache.clear();
}

/** Members matching an in-progress `@query`, best-effort and case-insensitive. */
export function filterRoster(roster: MentionCandidate[], query: string): MentionCandidate[] {
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? roster.filter((candidate) => candidate.label.toLowerCase().includes(needle))
    : roster;
  return matches.slice(0, 6);
}
