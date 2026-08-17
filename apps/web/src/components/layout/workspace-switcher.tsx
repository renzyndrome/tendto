/**
 * Workspace switcher — the sidebar header. Lists every workspace the user is a member of
 * (straight from the replica, so it is instant and works offline) and creates new ones.
 *
 * Switching is local UI state. Creating requires the server, so the "+ New workspace" action
 * shows a pending state and the parent surfaces failures — see lib/workspaces.ts for why a
 * workspace cannot simply be written to the replica.
 */
import { useQuery } from "@powersync/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useUiStore } from "../../stores/ui";

interface WorkspaceRow {
  id: string;
  name: string;
}

interface WorkspaceSwitcherProps {
  activeWorkspaceId: string | null;
  creating: boolean;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onOpenSettings: () => void;
}

export function WorkspaceSwitcher({
  activeWorkspaceId,
  creating,
  onSwitch,
  onCreate,
  onOpenSettings,
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: rows } = useQuery<WorkspaceRow>(
    "SELECT id, name FROM workspaces ORDER BY created_at",
  );
  const knownIds = useUiStore((s) => s.knownWorkspaceIds);

  // The replica can hold workspaces the server no longer agrees with, which would show up
  // here as phantom entries (often duplicate names). When the server's list is known, it
  // wins; when it isn't (offline), show what synced rather than nothing.
  const workspaces = useMemo(
    () => (knownIds ? rows.filter((row) => knownIds.includes(row.id)) : rows),
    [rows, knownIds],
  );

  const active = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const activeName = active?.name ?? "Workspace";

  // Close on outside click / Escape — a menu that traps the user is worse than no menu.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) closeMenu();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (naming) inputRef.current?.focus();
  }, [naming]);

  function closeMenu(): void {
    setOpen(false);
    setNaming(false);
    setDraft("");
  }

  function submitNewWorkspace(): void {
    const name = draft.trim();
    if (!name) return;
    onCreate(name);
    closeMenu();
  }

  return (
    <div ref={containerRef} className="relative px-3 py-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch workspace"
        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover"
      >
        <span className="truncate text-sm font-semibold text-fg">{activeName}</span>
        <span aria-hidden className="shrink-0 text-xs text-subtle">
          ▾
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-3 right-3 z-30 mt-1 overflow-hidden rounded-lg border border-line bg-elevated shadow-lg"
        >
          <ul className="max-h-64 overflow-y-auto py-1">
            {workspaces.map((workspace) => (
              <li key={workspace.id}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onSwitch(workspace.id);
                    closeMenu();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-muted hover:bg-hover hover:text-fg"
                >
                  <span aria-hidden className="w-3 shrink-0 text-xs">
                    {workspace.id === activeWorkspaceId ? "✓" : ""}
                  </span>
                  <span className="truncate">{workspace.name || "Untitled"}</span>
                </button>
              </li>
            ))}
          </ul>

          <div className="border-t border-line p-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenu();
                onOpenSettings();
              }}
              className="w-full rounded px-3 py-1.5 text-left text-sm text-muted hover:bg-hover hover:text-fg"
            >
              Workspace settings
            </button>
          </div>

          <div className="border-t border-line p-1">
            {naming ? (
              <div className="flex items-center gap-1 p-1">
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") submitNewWorkspace();
                    if (event.key === "Escape") {
                      setNaming(false);
                      setDraft("");
                    }
                  }}
                  placeholder="Workspace name"
                  aria-label="New workspace name"
                  maxLength={200}
                  className="min-w-0 flex-1 rounded border border-line bg-app px-2 py-1 text-sm text-fg outline-none placeholder:text-subtle focus:border-fg"
                />
                <button
                  type="button"
                  onClick={submitNewWorkspace}
                  disabled={!draft.trim() || creating}
                  className="shrink-0 rounded bg-accent px-2 py-1 text-xs font-medium text-on-accent disabled:opacity-50"
                >
                  {creating ? "…" : "Create"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                role="menuitem"
                onClick={() => setNaming(true)}
                disabled={creating}
                className="w-full rounded px-3 py-1.5 text-left text-sm text-muted hover:bg-hover hover:text-fg disabled:opacity-50"
              >
                {creating ? "Creating…" : "+ New workspace"}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
