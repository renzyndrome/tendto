/**
 * The presence poll loop, as a hook.
 *
 * Three things keep it quiet: it stops entirely while the tab is hidden (you are not looking, so
 * you are not there), the server chooses the cadence — lazy when you are alone, which is nearly
 * always — and a failed request backs off rather than retrying in a tight loop.
 *
 * A timeout chain rather than setInterval, because the delay changes between ticks and an
 * interval would keep firing while a slow request is still in flight.
 *
 * The generation counter is what makes the chain safe to interrupt. Clearing a timeout cannot
 * stop a tick that is already awaiting its request, and when that tick resolves it would happily
 * schedule the next one — so a hidden→visible flip caught mid-request would leave TWO chains
 * running, forever, doubling the poll rate. A tick therefore only acts if it still owns the
 * current generation. The AbortController closes the matching server-side race: without it an
 * in-flight heartbeat can commit *after* the `leave` on teardown, resurrecting you on a page you
 * have left for the full TTL.
 */
import { useEffect, useRef, useState } from "react";

import { heartbeat, leave, scopeKey, type PresenceScope, type Viewer } from "./client";

/** Backoff when the API is unreachable — offline, or the server is unhappy. */
const ERROR_RETRY_MS = 30_000;

/** Same people, same order? Then keep the old array so React can skip the re-render. */
function sameViewers(a: Viewer[], b: Viewer[]): boolean {
  return (
    a.length === b.length &&
    a.every((viewer, i) => viewer.user_id === b[i].user_id && viewer.label === b[i].label)
  );
}

export function usePresence(workspaceId: string | null, scope: PresenceScope | null): Viewer[] {
  const [others, setOthers] = useState<Viewer[]>([]);
  // The identity of what we are watching. Depending on the object itself would restart the loop
  // on every render, since callers build the scope inline.
  const key = scope ? scopeKey(scope) : null;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  useEffect(() => {
    const current = scopeRef.current;
    if (!workspaceId || !current) {
      setOthers([]);
      return;
    }

    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight: AbortController | null = null;
    let stopped = false;

    /** Invalidate the running chain: cancel its next tick and its current request. */
    const halt = () => {
      generation += 1;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      inFlight?.abort();
      inFlight = null;
    };

    const tick = async (mine: number) => {
      // Hidden tabs go silent. The server's TTL then drops us, which is the truth: a background
      // tab is not somebody reading the page.
      if (stopped || mine !== generation || document.visibilityState !== "visible") return;
      const controller = new AbortController();
      inFlight = controller;
      try {
        const state = await heartbeat(workspaceId, current, controller.signal);
        if (stopped || mine !== generation) return; // a newer chain owns the loop now
        setOthers((prev) => (sameViewers(prev, state.others) ? prev : state.others));
        timer = setTimeout(() => void tick(mine), state.next_poll_ms);
      } catch {
        if (stopped || mine !== generation) return;
        // Offline, aborted, or erroring: show nobody rather than a stale list, and retry later.
        setOthers((prev) => (prev.length === 0 ? prev : []));
        timer = setTimeout(() => void tick(mine), ERROR_RETRY_MS);
      } finally {
        if (inFlight === controller) inFlight = null;
      }
    };

    const start = () => {
      halt(); // never leave a previous chain running alongside the new one
      void tick(generation);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        start(); // coming back should feel immediate
      } else {
        halt();
        setOthers([]);
        leave(workspaceId, current);
      }
    };

    // The tab going away for good: same courtesy, and `leave` uses keepalive so it survives.
    const onPageHide = () => {
      halt();
      leave(workspaceId, current);
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      stopped = true;
      halt(); // abort before leaving, or the in-flight heartbeat undoes the DELETE
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      // Navigating to another page clears the marker there immediately instead of leaving a
      // ghost until the TTL catches up.
      leave(workspaceId, current);
    };
  }, [workspaceId, key]);

  return others;
}
