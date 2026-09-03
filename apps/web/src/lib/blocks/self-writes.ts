/**
 * A tiny channel from "we just saved this document" to "someone else changed this document".
 *
 * `useExternalEdit` decides whether the replica holds an edit the open editor did not make. It
 * cannot answer that from the replica alone: our own save changes the rows exactly as a remote
 * one does. So the writer publishes the fingerprint of what it wrote, and the watcher treats
 * that as the new baseline.
 *
 * Kept in its own module so `serialize.ts` (the writer) and the hook (the reader) do not have
 * to import each other.
 */

/**
 * `updated_at` as an instant, because the TEXT is not stable across a sync round-trip.
 *
 * A local write stores what `toISOString()` produced (`2026-09-03T15:55:42.276Z`). The same
 * row, after FastAPI has stored it and PowerSync has replicated it back, reads as Postgres
 * writes timestamptz (`2026-09-03 15:55:42.276+00`) — the same moment, a different string.
 * Comparing the strings therefore made every one of our own saves look like a foreign edit a
 * second or two after it went up. The server keeps the client's edit time (see
 * `_incoming_updated_at` in sync.py), so the instant survives exactly; only the spelling does not.
 */
function toInstant(value: string): number {
  // Postgres text form → ISO: the space becomes "T", and a bare "+00" offset gains its minutes.
  const iso = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? Date.parse(value) : parsed;
}

/** Order-independent fingerprint of a set of rows, as `id@instant` pairs. */
export function fingerprintRows(rows: { id: string; updated_at: string }[]): string {
  return rows
    .map((row) => `${row.id}@${toInstant(row.updated_at)}`)
    .sort()
    .join("|");
}

type Listener = (ownerKey: string, fingerprint: string) => void;

const listeners = new Set<Listener>();

export const ownerKeyOf = (kind: string, id: string) => `${kind}:${id}`;

/** Publish the complete fingerprint of what we just wrote for one owner. */
export function publishSelfWrite(ownerKey: string, fingerprint: string): void {
  for (const listener of listeners) listener(ownerKey, fingerprint);
}

export function onSelfWrite(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
