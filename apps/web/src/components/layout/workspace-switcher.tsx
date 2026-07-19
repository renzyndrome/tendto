/**
 * Workspace switcher — the sidebar brand row. Lists every workspace the user belongs to (the
 * replica only holds workspaces they're a member of, so a plain `workspaces` query IS "my
 * workspaces"), lets them switch the active one, and remembers the choice per device. Self-heals:
 * if the active workspace is gone (e.g. the user was removed and it synced away), it falls back to
 * the first available one.
 */
import { useQuery } from "@powersync/react";
import { useEffect, useRef, useState } from "react";

import { useSession } from "../../lib/auth/client";
import { createWorkspace, saveActiveWorkspaceId } from "../../lib/workspaces";
import { useUiStore } from "../../stores/ui";
import { Icon } from "../ui/icon";

interface WorkspaceRow {
  id: string;
  name: string;
}

interface RoleRow {
  workspace_id: string;
  role: string;
}

export function WorkspaceSwitcher() {
  const activeId = useUiStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useUiStore((s) => s.setActiveWorkspace);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const { data: session } = useSession();
  const userId = session?.user?.id ?? "";

  const { data: workspaces } = useQuery<WorkspaceRow>(
    "SELECT id, name FROM workspaces ORDER BY created_at",
  );
  const { data: myRoles } = useQuery<RoleRow>(
    "SELECT workspace_id, role FROM memberships WHERE user_id = ?",
    [userId],
  );
  const roleFor = new Map(myRoles.map((r) => [r.workspace_id, r.role]));

  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  // A just-created workspace we're waiting to appear in the replica before switching to it, so the
  // self-heal below can't revert the selection during the ~1s sync-down.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Switch to a newly created workspace once it has synced into the replica.
  useEffect(() => {
    if (pendingId && workspaces.some((w) => w.id === pendingId)) {
      setActiveWorkspace(pendingId);
      saveActiveWorkspaceId(pendingId);
      setPendingId(null);
      setOpen(false);
    }
  }, [pendingId, workspaces, setActiveWorkspace]);

  // Self-heal: keep an active workspace that actually exists in the replica (unless we're mid-create).
  useEffect(() => {
    if (workspaces.length === 0 || pendingId) return;
    const activeStillValid = activeId && workspaces.some((w) => w.id === activeId);
    if (!activeStillValid) {
      const next = workspaces[0].id;
      setActiveWorkspace(next);
      saveActiveWorkspaceId(next);
    }
  }, [workspaces, activeId, pendingId, setActiveWorkspace]);

  // Close the menu on outside click.
  useEffect(() => {
    if (!open) return;
    function onClick(event: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];
  const activeName = active?.name ?? "TendTo";

  function choose(id: string): void {
    setActiveWorkspace(id);
    saveActiveWorkspaceId(id);
    setOpen(false);
  }

  async function handleCreate(): Promise<void> {
    const name = newName.trim();
    if (pendingId) return; // a create is already in flight
    try {
      const info = await createWorkspace(name || "Untitled");
      setNewName("");
      setAdding(false);
      // Don't switch yet — wait for it to sync into the replica (see the effect above).
      setPendingId(info.id);
    } catch {
      // Offline / API down: leave the input so the user can retry.
    }
  }

  return (
    <div ref={menuRef} className="relative flex items-center gap-2.5 px-4 pb-2.5 pt-4">
      <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-row bg-accent text-[12px] font-bold text-accent-contrast">
        T
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-row py-0.5 text-left hover:bg-row-hover"
      >
        <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-[-0.01em] text-ink">
          {activeName}
        </span>
        <Icon name="chevron-down" size={14} className="shrink-0 text-muted" />
      </button>
      <button
        type="button"
        onClick={() => setSidebarOpen(false)}
        aria-label="Close sidebar"
        className="-mr-1 flex h-7 w-7 items-center justify-center rounded-row text-muted hover:bg-row-hover hover:text-ink md:hidden"
      >
        <Icon name="close" size={16} />
      </button>

      {open ? (
        <div className="absolute left-3 right-3 top-[52px] z-20 animate-pop-in overflow-hidden rounded-card border border-hairline-strong bg-surface p-1 shadow-menu">
          <div className="px-2.5 py-1 text-section-label uppercase text-faint">Workspaces</div>
          {workspaces.map((w) => {
            const isActive = w.id === active?.id;
            const role = roleFor.get(w.id);
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => choose(w.id)}
                className={
                  "flex w-full items-center gap-2 rounded-row px-2.5 py-1.5 text-left text-[13px] " +
                  (isActive ? "bg-accent-soft text-accent-soft-text" : "text-body row-hover")
                }
              >
                <span className="min-w-0 flex-1 truncate">{w.name || "Untitled"}</span>
                {role ? (
                  <span className="shrink-0 text-[10.5px] capitalize text-faint">{role}</span>
                ) : null}
                {isActive ? (
                  <Icon name="check" size={13} className="shrink-0 text-accent-soft-text" />
                ) : null}
              </button>
            );
          })}

          <div className="my-1 border-t border-hairline" />
          {adding ? (
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
                else if (e.key === "Escape") {
                  setAdding(false);
                  setNewName("");
                }
              }}
              onBlur={() => {
                setAdding(false); // cancel on blur; press Enter to create
                setNewName("");
              }}
              placeholder="Workspace name…"
              aria-label="New workspace name"
              className="w-full rounded-row bg-canvas px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-muted"
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              disabled={pendingId !== null}
              className="flex w-full items-center gap-2 rounded-row px-2.5 py-1.5 text-left text-[13px] text-muted row-hover disabled:opacity-50"
            >
              <Icon name="plus" size={13} className="text-faint" />
              {pendingId ? "Creating…" : "New workspace"}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
