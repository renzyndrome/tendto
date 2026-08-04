/**
 * Workspace settings — rename, members + invitations, and deletion.
 *
 * Rename is a LOCAL write (it's an ordinary row in the replica, so it's instant and works
 * offline). Everything else is a real API call: membership and invitation changes are
 * permission decisions that only the server can make, and invitations never sync to devices.
 * See lib/members.ts.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "../../lib/api/client";
import {
  deleteWorkspace,
  fetchMembers,
  inviteMember,
  removeMember,
  revokeInvitation,
  updateMemberRole,
  type Invitation,
  type Member,
  type Role,
  type WorkspaceMembers,
  ROLE_HINTS,
  ROLE_LABELS,
} from "../../lib/members";
import { invalidateAssignees } from "../../lib/items/assignees";
import { renameWorkspace } from "../../lib/workspaces";

interface WorkspaceSettingsProps {
  workspaceId: string;
  workspaceName: string;
  /** True when this is the user's only workspace — deletion is refused server-side too. */
  isOnlyWorkspace: boolean;
  onClose: () => void;
  /** The workspace is no longer ours — deleted, or we left it. */
  onGone: () => void;
}

const INVITABLE_ROLES: Role[] = ["editor", "viewer"];

export function WorkspaceSettings({
  workspaceId,
  workspaceName,
  isOnlyWorkspace,
  onClose,
  onGone,
}: WorkspaceSettingsProps) {
  const [data, setData] = useState<WorkspaceMembers | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    try {
      setData(await fetchMembers(workspaceId));
      setLoadError(null);
    } catch (err) {
      // A 404 here means the server doesn't consider this workspace ours — it was deleted, we
      // were removed, or the replica is holding a row the server has forgotten. Showing
      // "Workspace not found" in a dialog would strand the user on a dead workspace with no
      // way out, so recover instead of reporting.
      if (err instanceof ApiError && err.status === 404) {
        onGone();
        return;
      }
      setLoadError(err instanceof Error ? err.message : "Couldn't load members");
    }
  }, [workspaceId, onGone]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Escape closes; the backdrop click is handled on the overlay itself.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isOwner = data?.your_role === "owner";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Workspace settings"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[8vh]"
    >
      <div
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-elevated shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold text-fg">Workspace settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="rounded px-2 text-subtle hover:text-fg"
          >
            ×
          </button>
        </header>

        <div className="space-y-6 px-5 py-4">
          <NameSection workspaceId={workspaceId} initialName={workspaceName} canEdit={!!data} />

          {loadError ? (
            <p role="alert" className="text-sm text-danger">
              {loadError}
            </p>
          ) : null}

          {data ? (
            <>
              <MembersSection
                workspaceId={workspaceId}
                members={data.members}
                isOwner={isOwner}
                onChanged={reload}
                onLeft={onGone}
              />
              {isOwner ? (
                <InviteSection workspaceId={workspaceId} onInvited={reload} />
              ) : null}
              {isOwner && data.invitations.length > 0 ? (
                <PendingSection
                  workspaceId={workspaceId}
                  invitations={data.invitations}
                  onChanged={reload}
                />
              ) : null}
              {isOwner ? (
                <DangerSection
                  workspaceId={workspaceId}
                  workspaceName={workspaceName}
                  isOnlyWorkspace={isOnlyWorkspace}
                  onDeleted={onGone}
                />
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">{title}</h3>
      {children}
    </section>
  );
}

/** Rename — a local write, so it applies instantly and offline. */
function NameSection({
  workspaceId,
  initialName,
  canEdit,
}: {
  workspaceId: string;
  initialName: string;
  canEdit: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [saved, setSaved] = useState(false);

  useEffect(() => setName(initialName), [initialName]);

  async function commit(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed || trimmed === initialName) return;
    await renameWorkspace(workspaceId, trimmed);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  }

  return (
    <Section title="Name">
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          disabled={!canEdit}
          maxLength={200}
          aria-label="Workspace name"
          className="min-w-0 flex-1 rounded-md border border-line bg-app px-3 py-1.5 text-sm text-fg outline-none placeholder:text-subtle focus:border-fg disabled:opacity-50"
        />
        {saved ? <span className="shrink-0 text-xs text-subtle">Saved</span> : null}
      </div>
    </Section>
  );
}

function MembersSection({
  workspaceId,
  members,
  isOwner,
  onChanged,
  onLeft,
}: {
  workspaceId: string;
  members: Member[];
  isOwner: boolean;
  onChanged: () => Promise<void>;
  onLeft: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>): Promise<void> {
    setError(null);
    try {
      await action();
      // Assignee pickers cache the member list per workspace — drop it so they refresh.
      invalidateAssignees(workspaceId);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <Section title={`Members (${members.length})`}>
      <ul data-testid="member-list" className="space-y-1">
        {members.map((member) => (
          <li
            key={member.user_id}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover/40"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-fg">
              {member.email ?? member.user_id}
              {member.is_you ? <span className="text-subtle"> (you)</span> : null}
            </span>
            {isOwner ? (
              <select
                value={member.role}
                onChange={(event) =>
                  void run(() =>
                    updateMemberRole(workspaceId, member.user_id, event.target.value as Role),
                  )
                }
                aria-label={`Role for ${member.email ?? member.user_id}`}
                className="shrink-0 rounded border border-line bg-app px-1.5 py-1 text-xs text-muted"
              >
                {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
                  <option key={role} value={role} title={ROLE_HINTS[role]}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            ) : (
              <span className="shrink-0 text-xs text-subtle">{ROLE_LABELS[member.role]}</span>
            )}
            {isOwner || member.is_you ? (
              <button
                type="button"
                onClick={() => {
                  const what = member.is_you
                    ? "Leave this workspace?"
                    : `Remove ${member.email ?? "this member"}?`;
                  if (!window.confirm(what)) return;
                  // Leaving removes our own access, so there is nothing left to reload —
                  // hand back to the sidebar to pick another workspace.
                  if (member.is_you) {
                    void removeMember(workspaceId, member.user_id).then(onLeft);
                  } else {
                    void run(() => removeMember(workspaceId, member.user_id));
                  }
                }}
                aria-label={member.is_you ? "Leave workspace" : `Remove ${member.email ?? ""}`}
                className="shrink-0 rounded px-1 text-subtle hover:text-danger"
              >
                ×
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Section>
  );
}

function InviteSection({
  workspaceId,
  onInvited,
}: {
  workspaceId: string;
  onInvited: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When no email provider is configured (or delivery failed), the link is the fallback.
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(): Promise<void> {
    const address = email.trim();
    if (!address || busy) return;
    setBusy(true);
    setError(null);
    setLink(null);
    try {
      const result = await inviteMember(workspaceId, address, role);
      setEmail("");
      if (!result.email_delivered) setLink(result.invite_url);
      await onInvited();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the invitation");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Invite someone">
      <div className="flex items-center gap-2">
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
          placeholder="teammate@example.com"
          aria-label="Invite by email"
          className="min-w-0 flex-1 rounded-md border border-line bg-app px-3 py-1.5 text-sm text-fg outline-none placeholder:text-subtle focus:border-fg"
        />
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
          aria-label="Invite role"
          className="shrink-0 rounded border border-line bg-app px-1.5 py-1.5 text-xs text-muted"
        >
          {INVITABLE_ROLES.map((option) => (
            <option key={option} value={option}>
              {ROLE_LABELS[option]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || email.trim().length === 0}
          className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Sending…" : "Invite"}
        </button>
      </div>
      <p className="mt-1 text-xs text-subtle">{ROLE_HINTS[role]}</p>

      {link ? (
        <div data-testid="invite-link" className="mt-2 rounded-md border border-line p-2">
          <p className="mb-1 text-xs text-muted">
            No email provider is configured, so nothing was sent. Share this link:
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-hover/40 px-2 py-1 text-xs text-fg">
              {link}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(link);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
              className="shrink-0 rounded border border-line px-2 py-1 text-xs text-muted hover:text-fg"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Section>
  );
}

function PendingSection({
  workspaceId,
  invitations,
  onChanged,
}: {
  workspaceId: string;
  invitations: Invitation[];
  onChanged: () => Promise<void>;
}) {
  return (
    <Section title={`Pending invitations (${invitations.length})`}>
      <ul data-testid="pending-invites" className="space-y-1">
        {invitations.map((invitation) => (
          <li
            key={invitation.id}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover/40"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-muted">{invitation.email}</span>
            <span className="shrink-0 text-xs text-subtle">{ROLE_LABELS[invitation.role]}</span>
            <button
              type="button"
              onClick={() => {
                void revokeInvitation(workspaceId, invitation.id).then(onChanged);
              }}
              aria-label={`Revoke invitation for ${invitation.email}`}
              className="shrink-0 rounded px-1 text-subtle hover:text-danger"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Type-to-confirm deletion: irreversible, and it destroys content for every member. */
function DangerSection({
  workspaceId,
  workspaceName,
  isOnlyWorkspace,
  onDeleted,
}: {
  workspaceId: string;
  workspaceName: string;
  isOnlyWorkspace: boolean;
  onDeleted: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = confirmation.trim() === workspaceName;

  async function remove(): Promise<void> {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteWorkspace(workspaceId);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete the workspace");
      setBusy(false);
    }
  }

  return (
    <Section title="Danger zone">
      <div className="rounded-md border border-danger/40 p-3">
        <p className="mb-2 text-sm text-muted">
          Deleting <span className="font-medium text-fg">{workspaceName}</span> removes its pages,
          collections and items for <em>everyone</em> in it. This cannot be undone.
        </p>
        {isOnlyWorkspace ? (
          <p className="text-xs text-subtle">
            This is your only workspace. Create another one before deleting it.
          </p>
        ) : (
          <>
            <label className="mb-1 block text-xs text-subtle" htmlFor="confirm-delete">
              Type <span className="font-medium text-muted">{workspaceName}</span> to confirm
            </label>
            <div className="flex items-center gap-2">
              <input
                id="confirm-delete"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder={workspaceName}
                className="min-w-0 flex-1 rounded-md border border-line bg-app px-3 py-1.5 text-sm text-fg outline-none placeholder:text-subtle focus:border-danger"
              />
              <button
                type="button"
                onClick={() => void remove()}
                disabled={!matches || busy}
                className="shrink-0 rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                {busy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </>
        )}
        {error ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Section>
  );
}
