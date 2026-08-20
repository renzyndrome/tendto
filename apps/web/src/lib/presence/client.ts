/**
 * Presence — "who else is looking at this?" — over polling.
 *
 * The only part of TendTo that reads from the network on a timer, and the only one that is not
 * offline-first: presence about a device that isn't connected is a contradiction, so this simply
 * goes quiet when the API is unreachable, the way the mention roster does.
 *
 * Why polling and not a socket: presence here is a low-stakes signal on a single-process API
 * with no broker. A WebSocket would buy a few seconds of latency and cost a token in the query
 * string (browsers cannot set headers on a WS handshake), a hand-rolled Origin check, and an
 * in-memory registry that shards silently at more than one worker. See routers/presence.py.
 */
import { apiFetch } from "../api/client";
import { getAuthToken } from "../auth/token";

const API_URL = import.meta.env.VITE_API_URL as string;

/** What the viewer is looking at. Mirrors the server's `scope` pattern. */
export type PresenceScope = { kind: "page" | "item"; id: string };

export interface Viewer {
  user_id: string;
  label: string;
}

interface PresenceState {
  others: Viewer[];
  next_poll_ms: number;
}

export const scopeKey = (scope: PresenceScope): string => `${scope.kind}:${scope.id}`;

/** Announce yourself and learn who else is here. The server also sets the next poll delay. */
export async function heartbeat(
  workspaceId: string,
  scope: PresenceScope,
  signal?: AbortSignal,
): Promise<PresenceState> {
  const res = await apiFetch("/presence/heartbeat", {
    method: "POST",
    signal,
    body: JSON.stringify({ workspace_id: workspaceId, scope: scopeKey(scope) }),
  });
  return (await res.json()) as PresenceState;
}

/**
 * Best-effort "I've gone", sent when leaving a page or closing the tab.
 *
 * `keepalive` is what makes this survive teardown — a normal fetch is cancelled the moment the
 * document goes away. It is deliberately NOT `navigator.sendBeacon`, which cannot carry an
 * Authorization header. Failure is fine and expected: the server's TTL is what actually makes
 * presence true, and this only spares teammates a stale marker for half a minute.
 *
 * One case where it silently does nothing: if the cached token has expired, `getAuthToken()` is
 * a network round-trip to the auth service, and on `pagehide` the document is gone before the
 * request is ever dispatched. That degrades to the TTL, which is the documented contract.
 */
export function leave(workspaceId: string, scope: PresenceScope): void {
  void getAuthToken()
    .then((token) =>
      fetch(`${API_URL}/presence/leave`, {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ workspace_id: workspaceId, scope: scopeKey(scope) }),
      }),
    )
    .catch(() => undefined);
}
