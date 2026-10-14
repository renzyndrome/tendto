/**
 * Pages made on this device during this visit to them (UI state, Zustand).
 *
 * A page just made from the sidebar is named at once, which would otherwise count as "started"
 * and bring the comment box straight in under a page that has barely begun. A fresh page keeps
 * the thread out of view until it is opened again: leaving it ends the visit, and so does a
 * reload, since this state lives in memory only.
 *
 * Leaving is deferred by a tick. React's StrictMode runs an effect's cleanup and setup again
 * right after mounting; a leave undone by the visit that follows it at once is not a real one.
 */
import { create } from "zustand";

interface FreshPagesState {
  ids: ReadonlySet<string>;
  /** Mark a page as just made here. */
  mark: (pageId: string) => void;
  /** The page is on screen: cancel a leave that was only StrictMode's remount. */
  visit: (pageId: string) => void;
  /** The page left the screen: it stops being fresh, unless visited again at once. */
  leave: (pageId: string) => void;
}

const pendingLeaves = new Map<string, ReturnType<typeof setTimeout>>();

export const useFreshPages = create<FreshPagesState>((set) => ({
  ids: new Set<string>(),
  mark: (pageId) => set((state) => ({ ids: new Set([...state.ids, pageId]) })),
  visit: (pageId) => {
    const pending = pendingLeaves.get(pageId);
    if (pending) clearTimeout(pending);
    pendingLeaves.delete(pageId);
  },
  leave: (pageId) => {
    const pending = pendingLeaves.get(pageId);
    if (pending) clearTimeout(pending);
    pendingLeaves.set(
      pageId,
      setTimeout(() => {
        pendingLeaves.delete(pageId);
        set((state) =>
          state.ids.has(pageId)
            ? { ids: new Set([...state.ids].filter((id) => id !== pageId)) }
            : state,
        );
      }, 0),
    );
  },
}));
