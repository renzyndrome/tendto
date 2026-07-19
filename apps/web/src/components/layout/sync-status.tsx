/**
 * Sync status — the deliberately subtle indicator in the sidebar footer. Never modal, never
 * blocking (a design invariant). Reads PowerSync's live status:
 *   synced   → steady green dot · "All changes saved · synced"
 *   syncing  → pulsing dot · "Syncing…"
 *   offline  → muted dot · "Saved locally — will sync"
 * Pass `compact` for the mobile top bar (dot only).
 */
import { useStatus } from "@powersync/react";

type SyncState = "synced" | "syncing" | "offline";

function resolve(connected: boolean, downloading: boolean, uploading: boolean): SyncState {
  if (!connected) return "offline";
  if (downloading || uploading) return "syncing";
  return "synced";
}

const LABELS: Record<SyncState, string> = {
  synced: "All changes saved · synced",
  syncing: "Syncing…",
  offline: "Saved locally — will sync",
};

export function SyncStatus({ compact = false }: { compact?: boolean }) {
  const status = useStatus();
  const state = resolve(
    Boolean(status.connected),
    Boolean(status.dataFlowStatus.downloading),
    Boolean(status.dataFlowStatus.uploading),
  );

  const dot = (
    <span
      className={
        "h-[7px] w-[7px] shrink-0 rounded-full " +
        (state === "offline" ? "bg-faint" : "bg-sync") +
        (state === "syncing" ? " animate-sync-pulse" : "")
      }
      aria-hidden
    />
  );

  if (compact) {
    return <span title={LABELS[state]}>{dot}</span>;
  }

  return (
    <div data-tour="sync" className="flex items-center gap-2 border-t border-hairline px-4 py-3">
      {dot}
      <span className="text-meta text-muted">{LABELS[state]}</span>
    </div>
  );
}
