/**
 * Share modal — invite teammates to the active workspace and manage members. Owners can mint
 * editor/viewer invite links and remove members; editors/viewers see a read-only member list.
 * Members + invites come from FastAPI (the membership lifecycle lives server-side); the resulting
 * membership rows sync back into the replica so the sidebar/switcher update on their own.
 */
import { useQuery } from "@powersync/react";
import { useCallback, useEffect, useState } from "react";

import { useSession } from "../../lib/auth/client";
import {
  createInvite,
  inviteUrl,
  listMembers,
  removeMember,
  type InvitableRole,
  type MemberList,
} from "../../lib/workspaces";
import { useUiStore } from "../../stores/ui";
import { Icon } from "../ui/icon";
import { Modal } from "../ui/modal";
import { SegmentedControl } from "../ui/segmented";

export function ShareModal() {
  const open = useUiStore((s) => s.shareOpen);
  const setOpen = useUiStore((s) => s.setShareOpen);
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);

  if (!open || !workspaceId) return null;
  return <ShareModalInner workspaceId={workspaceId} onClose={() => setOpen(false)} />;
}

function ShareModalInner({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const { data: session } = useSession();
  const myId = session?.user?.id ?? "";

  const { data: nameRows } = useQuery<{ name: string }>(
    "SELECT name FROM workspaces WHERE id = ?",
    [workspaceId],
  );
  const workspaceName = nameRows[0]?.name ?? "this workspace";

  const [data, setData] = useState<MemberList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<InvitableRole>("editor");
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setData(await listMembers(workspaceId));
      setError(null);
    } catch {
      setError("Couldn't load members. Are you online?");
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const myRole = data?.members.find((m) => m.user_id === myId)?.role;
  const isOwner = myRole === "owner";

  async function handleCreate(): Promise<void> {
    if (creating) return;
    setCreating(true);
    setCopied(false);
    try {
      const invite = await createInvite(workspaceId, role);
      const url = inviteUrl(invite.token);
      setLink(url);
      await refresh();
    } catch {
      setError("Couldn't create the invite link.");
    } finally {
      setCreating(false);
    }
  }

  async function copy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setLink(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Copy failed — select the link and copy manually.");
    }
  }

  async function handleRemove(userId: string): Promise<void> {
    if (!window.confirm("Remove this member from the workspace?")) return;
    try {
      await removeMember(workspaceId, userId);
      await refresh();
    } catch {
      setError("Couldn't remove that member.");
    }
  }

  return (
    <Modal width={460} labelledBy="share-title" onClose={onClose}>
      <div className="border-b border-hairline px-6 py-4">
        <h2 id="share-title" className="text-[15px] font-semibold text-ink">
          Share “{workspaceName}”
        </h2>
        <p className="mt-0.5 text-[12.5px] text-muted">
          {isOwner
            ? "Invite teammates with an editor or viewer link."
            : "You have " + (myRole ?? "guest") + " access to this workspace."}
        </p>
      </div>

      {isOwner ? (
        <div className="border-b border-hairline px-6 py-4">
          <div className="flex items-center gap-2">
            <SegmentedControl
              ariaLabel="Invite role"
              value={role}
              onChange={setRole}
              options={[
                { value: "editor", label: "Can edit" },
                { value: "viewer", label: "Can view" },
              ]}
            />
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating}
              className="ml-auto rounded-input bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create link"}
            </button>
          </div>
          {link ? (
            <div className="mt-3 flex items-center gap-2 rounded-input border border-border-soft bg-canvas px-2.5 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-secondary">
                {link}
              </span>
              <button
                type="button"
                onClick={() => void copy(link)}
                className="flex shrink-0 items-center gap-1 rounded-row px-2 py-1 text-[11.5px] font-medium text-accent-soft-text hover:bg-accent-soft"
              >
                <Icon name={copied ? "check" : "copy"} size={13} />
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="max-h-[46vh] overflow-y-auto px-6 py-4">
        <div className="mb-2 text-section-label uppercase text-faint">Members</div>
        {error ? <p className="mb-2 text-[12.5px] text-overdue">{error}</p> : null}
        <ul className="space-y-1">
          {(data?.members ?? []).map((m) => (
            <li key={m.user_id} className="flex items-center gap-2 rounded-row px-1.5 py-1.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold uppercase text-accent-soft-text">
                {m.user_id.slice(0, 2)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-body">
                {m.user_id === myId ? "You" : m.user_id}
              </span>
              <span className="shrink-0 text-[11.5px] capitalize text-muted">{m.role}</span>
              {isOwner && m.user_id !== myId ? (
                <button
                  type="button"
                  onClick={() => void handleRemove(m.user_id)}
                  aria-label="Remove member"
                  className="shrink-0 rounded p-1 text-faint hover:text-overdue"
                >
                  <Icon name="close" size={14} />
                </button>
              ) : null}
            </li>
          ))}
          {data && data.members.length === 0 ? (
            <li className="px-1.5 py-2 text-[12.5px] text-muted">Just you so far.</li>
          ) : null}
        </ul>

        {isOwner && data && data.invites.length > 0 ? (
          <>
            <div className="mb-2 mt-4 text-section-label uppercase text-faint">Pending invites</div>
            <ul className="space-y-1">
              {data.invites.map((inv) => (
                <li
                  key={inv.token}
                  className="flex items-center gap-2 rounded-row px-1.5 py-1.5 text-[12.5px]"
                >
                  <Icon name="share" size={13} className="shrink-0 text-faint" />
                  <span className="flex-1 truncate capitalize text-secondary">
                    {inv.role} link
                  </span>
                  <button
                    type="button"
                    onClick={() => void copy(inviteUrl(inv.token))}
                    className="shrink-0 rounded-row px-2 py-1 text-[11.5px] font-medium text-accent-soft-text hover:bg-accent-soft"
                  >
                    Copy link
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
