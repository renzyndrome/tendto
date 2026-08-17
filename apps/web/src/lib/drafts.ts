/**
 * Crash-safe drafts.
 *
 * Every write in this app is asynchronous — edits land in the local SQLite replica through
 * PowerSync's worker, and PowerSync uploads from there. That is fine until the page goes away
 * mid-edit: a reload or a tab close inside the autosave debounce tears everything down before
 * the write completes, and flushing on `pagehide` does not help because the browser will not
 * wait for a promise.
 *
 * localStorage writes ARE synchronous, so an editor stashes its pending value here on the way
 * out and replays it into the replica on the next mount. The draft is removed as soon as a real
 * save succeeds, so a stale draft can never shadow synced content.
 *
 * Everything here is best-effort: storage can be full or blocked (private mode), and the
 * debounced save remains the primary path.
 */

const PREFIX = "tendto:draft";

/** `kind` separates namespaces (e.g. "page", "item", "page-title") so ids can't collide. */
export function draftKey(kind: string, id: string): string {
  return `${PREFIX}:${kind}:${id}`;
}

export function readDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { value?: unknown };
    return "value" in parsed ? (parsed.value as T) : null;
  } catch {
    return null;
  }
}

export function writeDraft(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify({ value, at: Date.now() }));
  } catch {
    // Quota or private mode — nothing to do but rely on the debounced save.
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * Run `stash` whenever the page is being hidden or torn down. Returns an unsubscribe fn.
 * `pagehide` covers reload/close/bfcache; `visibilitychange` covers tab switches and mobile
 * backgrounding, which is where a phone is most likely to kill the tab.
 */
export function onPageHidden(stash: () => void): () => void {
  const onVisibility = () => {
    if (document.visibilityState === "hidden") stash();
  };
  window.addEventListener("pagehide", stash);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.removeEventListener("pagehide", stash);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
