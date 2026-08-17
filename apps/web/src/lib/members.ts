/**
 * Workspace sharing — members and invitations.
 *
 * These are true API calls, not replica reads: `workspace_invitations` is deliberately not a
 * synced table (it holds other people's emails and bearer tokens), and member emails live in
 * better-auth's `user` table which never syncs to devices. Membership ROWS do sync, but only
 * as opaque user ids — the display names come from here.
 */
import { apiFetch } from "./api/client";

export type Role = "owner" | "editor" | "viewer";

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};

export const ROLE_HINTS: Record<Role, string> = {
  owner: "Full access, can manage members and delete the workspace",
  editor: "Can create and edit content",
  viewer: "Can read, but not change anything",
};

export interface Member {
  user_id: string;
  email: string | null;
  name: string | null;
  role: Role;
  is_you: boolean;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  expires_at: string;
}

export interface WorkspaceMembers {
  members: Member[];
  invitations: Invitation[];
  your_role: Role;
}

export interface InviteResult {
  invitation: Invitation;
  invite_url: string;
  email_delivered: boolean;
  detail: string;
}

export interface InvitationPreview {
  workspace_name: string;
  role: Role;
  email: string;
  expired: boolean;
}

export async function fetchMembers(workspaceId: string): Promise<WorkspaceMembers> {
  const res = await apiFetch(`/workspaces/${workspaceId}/members`);
  return (await res.json()) as WorkspaceMembers;
}

export async function inviteMember(
  workspaceId: string,
  email: string,
  role: Role,
): Promise<InviteResult> {
  const res = await apiFetch(`/workspaces/${workspaceId}/invitations`, {
    method: "POST",
    body: JSON.stringify({ email, role }),
  });
  return (await res.json()) as InviteResult;
}

export async function revokeInvitation(
  workspaceId: string,
  invitationId: string,
): Promise<void> {
  await apiFetch(`/workspaces/${workspaceId}/invitations/${invitationId}`, { method: "DELETE" });
}

export async function updateMemberRole(
  workspaceId: string,
  userId: string,
  role: Role,
): Promise<void> {
  await apiFetch(`/workspaces/${workspaceId}/members/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export async function removeMember(workspaceId: string, userId: string): Promise<void> {
  await apiFetch(`/workspaces/${workspaceId}/members/${userId}`, { method: "DELETE" });
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  await apiFetch(`/workspaces/${workspaceId}`, { method: "DELETE" });
}

export async function previewInvitation(token: string): Promise<InvitationPreview> {
  const res = await apiFetch(`/invitations/${token}`);
  return (await res.json()) as InvitationPreview;
}

export async function acceptInvitation(token: string): Promise<string> {
  const res = await apiFetch(`/invitations/${token}/accept`, { method: "POST" });
  const body = (await res.json()) as { workspace_id: string };
  return body.workspace_id;
}
