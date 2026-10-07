/**
 * A delete that can still be undone (UI state, Zustand).
 *
 * Deleting from the sidebar hides the rows at once and only writes the delete after a short
 * window, so Undo is a pure cancel: nothing was written, so nothing has to be restored. That
 * matters here, because a real delete cannot be put back: Postgres cascades a page's comments
 * from the FK, and those are gone for good once the delete reaches the server.
 *
 * The delete is written early whenever the window can no longer be trusted to finish: a
 * second delete, the tab being hidden or closed (switching tabs ends the window too, on
 * purpose: a backgrounded tab may never return), or sign-out. Written locally, that is; the
 * upload follows as for any edit. If the tab dies before even the local write, or sign-out
 * clears the queue before it uploads, the rows come back, which is the safe way to fail.
 */
import { useMemo } from "react";
import { create } from "zustand";

import { onPageHidden } from "../lib/drafts";

/** How long Undo is offered. */
export const UNDO_WINDOW_MS = 6000;

/** How long written rows stay hidden after the delete resolves; see `flush`. */
const RELEASE_DELAY_MS = 1000;

export interface PendingDelete {
  /** What the toast says, e.g. `"Plan" deleted.` */
  label: string;
  /** Rows hidden from view until the delete lands or is undone. */
  ids: readonly string[];
  /** Write the delete. */
  commit: () => Promise<void>;
  /** Reopen what was open when it was deleted, if anything was. */
  restore?: () => void;
}

interface PendingDeleteState {
  pending: PendingDelete | null;
  /** Rows whose delete is being written right now: still hidden, no longer undoable. */
  committing: ReadonlySet<string>;
  schedule: (next: PendingDelete) => void;
  undo: () => void;
  flush: () => Promise<void>;
}

let timer: ReturnType<typeof setTimeout> | null = null;

function clearTimer(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

export const usePendingDelete = create<PendingDeleteState>((set, get) => ({
  pending: null,
  committing: new Set<string>(),

  schedule: (next) => {
    // One undo at a time: the previous delete lands now rather than being forgotten.
    void get().flush();
    set({ pending: next });
    timer = setTimeout(() => void get().flush(), UNDO_WINDOW_MS);
  },

  undo: () => {
    clearTimer();
    const current = get().pending;
    set({ pending: null });
    current?.restore?.();
  },

  flush: async () => {
    const current = get().pending;
    if (!current) return;
    clearTimer();
    set((state) => ({
      pending: null,
      committing: new Set([...state.committing, ...current.ids]),
    }));
    try {
      await current.commit();
    } catch (err) {
      // The rows reappear below, which says plainly that the delete did not happen.
      console.error("Delete failed", err);
    } finally {
      // Held a moment past the write: the replica's watched queries re-emit after it resolves,
      // and releasing the ids first would flash the deleted rows back for a frame.
      setTimeout(() => {
        set((state) => ({
          committing: new Set([...state.committing].filter((id) => !current.ids.includes(id))),
        }));
      }, RELEASE_DELAY_MS);
    }
  },
}));

// A hidden or closing tab may never come back to finish the window.
onPageHidden(() => void usePendingDelete.getState().flush());

/** The same set as `useHiddenIds`, read once, for a click handler rather than a render. */
export function hiddenIdsNow(): ReadonlySet<string> {
  const { pending, committing } = usePendingDelete.getState();
  return new Set([...(pending?.ids ?? []), ...committing]);
}

/** Every row hidden because its delete is pending or being written. */
export function useHiddenIds(): ReadonlySet<string> {
  const pending = usePendingDelete((state) => state.pending);
  const committing = usePendingDelete((state) => state.committing);
  return useMemo(() => new Set([...(pending?.ids ?? []), ...committing]), [pending, committing]);
}
