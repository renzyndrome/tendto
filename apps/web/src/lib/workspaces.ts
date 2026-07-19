/**
 * Shared-workspace collaboration — the client side of the invites/members API.
 *
 * These are true API calls (auth/permission surface), NOT content: they go through FastAPI, which
 * owns the membership lifecycle. The resulting membership rows sync back into the local replica via
 * PowerSync, so the sidebar/switcher update reactively once the change lands. The active-workspace
 * choice is a per-device UI preference (localStorage), not synced content.
 */
import { apiFetch } from "./api/client";

export type WorkspaceRole = "owner" | "editor" | "viewer";
export type InvitableRole = "editor" | "viewer";

export interface WorkspaceInfo {
  id: string;
  name: string;
  role: string;
}

/** Create a new workspace with the caller as owner. Returns the new workspace (id/name/role).
 *  The workspace + owner membership then sync down into the local replica via PowerSync. */
export async function createWorkspace(name: string): Promise<WorkspaceInfo> {
  const res = await apiFetch("/workspaces", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return (await res.json()) as WorkspaceInfo;
}

export interface InviteInfo {
  token: string;
  workspace_id: string;
  role: string;
  email: string | null;
  expires_at: string;
  accepted_by: string | null;
}

export interface InvitePreview {
  workspace_id: string;
  workspace_name: string;
  role: string;
  valid: boolean;
  reason: string | null;
}

export interface AcceptInviteResult {
  workspace_id: string;
  workspace_name: string;
  role: string;
  already_member: boolean;
}

export interface MemberInfo {
  user_id: string;
  role: string;
  name?: string | null;
  email?: string | null;
}

/** Human label for a member: display name, else email, else a short id. */
export function memberLabel(m: MemberInfo): string {
  return m.name || m.email || `${m.user_id.slice(0, 6)}…`;
}

/** 1–2 char avatar initials for a member. */
export function memberInitials(m: MemberInfo): string {
  const source = m.name || m.email || m.user_id;
  const parts = source.trim().split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export interface MemberList {
  members: MemberInfo[];
  invites: InviteInfo[];
}

export async function createInvite(
  workspaceId: string,
  role: InvitableRole,
): Promise<InviteInfo> {
  const res = await apiFetch("/workspaces/invites", {
    method: "POST",
    body: JSON.stringify({ workspace_id: workspaceId, role }),
  });
  return (await res.json()) as InviteInfo;
}

export async function previewInvite(token: string): Promise<InvitePreview> {
  const res = await apiFetch(`/workspaces/invites/${encodeURIComponent(token)}`);
  return (await res.json()) as InvitePreview;
}

export async function acceptInvite(token: string): Promise<AcceptInviteResult> {
  const res = await apiFetch(`/workspaces/invites/${encodeURIComponent(token)}/accept`, {
    method: "POST",
  });
  return (await res.json()) as AcceptInviteResult;
}

export async function listMembers(workspaceId: string): Promise<MemberList> {
  const res = await apiFetch(`/workspaces/${workspaceId}/members`);
  return (await res.json()) as MemberList;
}

export async function removeMember(workspaceId: string, memberUserId: string): Promise<void> {
  await apiFetch(`/workspaces/${workspaceId}/members/${encodeURIComponent(memberUserId)}`, {
    method: "DELETE",
  });
}

/** Build the shareable URL for an invite token (points at the accept route). */
export function inviteUrl(token: string): string {
  return `${window.location.origin}/invite/${token}`;
}

// --- active-workspace persistence (per device) ---------------------------------------------

const ACTIVE_KEY = "tendto:active-workspace";

export function loadActiveWorkspaceId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function saveActiveWorkspaceId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // ignore quota/private-mode failures
  }
}
