/**
 * "Updated elsewhere" detection for an open editor.
 *
 * An open editor is hydrated ONCE and never re-read — a reactive query would fight BlockNote's
 * own document state (see `loadBlocks`). That is right for the editor, but it means a page
 * changed on another device sits silently under you, and your next save overwrites it: the
 * row-level last-write-wins the server applies is invisible from here. This hook makes it
 * visible. It is a NOTICE, not a merge — you are told, and you choose to reload.
 *
 * Three deliberate choices:
 *
 *  - **Clock-free.** Comparing `max(updated_at)` against our own last write would miss any
 *    device whose clock runs behind ours — exactly the case where a silent overwrite hurts
 *    most. We compare the SET of `(id, updated_at)` pairs instead, so a difference is a
 *    difference no matter whose clock produced it.
 *  - **Our own saves are told apart from theirs by the writer, not guessed at.** `writeBlocks`
 *    publishes the fingerprint of what it just wrote (see `self-writes.ts`). Without that,
 *    every autosave would announce itself as somebody else's edit.
 *  - **Only a reading of the replica can raise the notice — never a publish.** An earlier
 *    version also re-decided when a self-write was published, which compared the new baseline
 *    against a not-yet-refreshed reading and raised a false alarm on the writer's own save.
 *    A publish now only records "this fingerprint is ours"; the decision waits for the read.
 *    So a missed or coalesced notification can at worst leave the notice unshown, never shown
 *    wrongly.
 *
 * Scope: the owner's BLOCKS — the body, which is what gets silently overwritten. A title
 * renamed on another device is not reported here.
 */
import { useQuery } from "@powersync/react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { BlockOwner } from "./serialize";
import { fingerprintRows, onSelfWrite, ownerKeyOf } from "./self-writes";

/** How many of our own recent fingerprints to remember. Saves coalesce; a handful is plenty. */
const SELF_HISTORY = 20;

interface StampRow {
  id: string;
  updated_at: string;
}

export interface ExternalEdit {
  /** True once the replica holds a version of this body that this device did not write. */
  changed: boolean;
  /** Accept the replica's current state as the baseline — call after re-hydrating from it. */
  adopt: () => void;
}

export function useExternalEdit(owner: BlockOwner): ExternalEdit {
  const column = owner.kind === "page" ? "page_id" : "item_id";
  const { data: rows } = useQuery<StampRow>(
    `SELECT id, updated_at FROM blocks WHERE ${column} = ?`,
    [owner.id],
  );

  const [changed, setChanged] = useState(false);
  const ownerKey = ownerKeyOf(owner.kind, owner.id);

  /** The state we consider ours. `undefined` until the first read, which is adopted as-is. */
  const baseline = useRef<string | undefined>(undefined);
  const latest = useRef<string | undefined>(undefined);
  /** Fingerprints this device wrote, in order, newest last. */
  const selfWrites = useRef<string[]>([]);

  // Switching to another page/card — or reloading this one — starts over. The baseline is
  // always the first read after mount, because a mount always follows a fresh hydrate: what
  // the editor is showing IS the replica at that moment.
  useEffect(() => {
    baseline.current = undefined;
    latest.current = undefined;
    selfWrites.current = [];
    setChanged(false);
  }, [ownerKey]);

  // Record what we wrote. Deliberately does NOT re-decide — see the header.
  useEffect(
    () =>
      onSelfWrite((key, fingerprint) => {
        if (key !== ownerKey) return;
        const history = [...selfWrites.current, fingerprint];
        selfWrites.current = history.slice(-SELF_HISTORY);
      }),
    [ownerKey],
  );

  useEffect(() => {
    if (!rows) return;
    const current = fingerprintRows(rows);
    latest.current = current;

    // The first read after mount is what the editor is showing.
    if (baseline.current === undefined) {
      baseline.current = current;
      setChanged(false);
      return;
    }
    // A state this device wrote. Adopt it — and drop the older entries, which can no longer
    // be what the replica holds.
    const mine = selfWrites.current.indexOf(current);
    if (mine !== -1) {
      selfWrites.current = selfWrites.current.slice(mine + 1);
      baseline.current = current;
      setChanged(false);
      return;
    }
    setChanged(current !== baseline.current);
  }, [rows]);

  const adopt = useCallback(() => {
    baseline.current = latest.current;
    setChanged(false);
  }, []);

  return { changed, adopt };
}
