/**
 * Short-lived JWT helper for the better-auth session.
 *
 * `getAuthToken()` fetches `GET {VITE_AUTH_URL}/api/auth/token` with the session cookie
 * (`credentials: "include"`), caches the token + its decoded `exp` in memory, and refreshes
 * when within 60s of expiry. The SAME token authenticates BOTH FastAPI (Bearer header) and the
 * PowerSync sync stream. Returns "" when the user is unauthenticated (no valid session).
 */

const AUTH_URL = import.meta.env.VITE_AUTH_URL as string;
const REFRESH_WINDOW_SECONDS = 60;

interface CachedToken {
  token: string;
  /** Unix seconds. 0 means the token carried no decodable `exp` (treated as stale). */
  exp: number;
}

let cached: CachedToken | null = null;
let inflight: Promise<string> | null = null;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function isFresh(entry: CachedToken): boolean {
  return entry.exp > nowSeconds() + REFRESH_WINDOW_SECONDS;
}

/** Decode a JWT payload's `exp` claim (Unix seconds). Returns 0 if it can't be read. */
function decodeExp(token: string): number {
  const payload = token.split(".")[1];
  if (!payload) return 0;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const json = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))),
    ) as { exp?: number };
    return typeof json.exp === "number" ? json.exp : 0;
  } catch {
    return 0;
  }
}

async function fetchFreshToken(): Promise<string> {
  const previous = cached;
  try {
    const res = await fetch(`${AUTH_URL}/api/auth/token`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      // 401/403 → genuinely unauthenticated. Drop any cached token.
      cached = null;
      return "";
    }
    const body = (await res.json()) as { token?: string };
    const token = body.token ?? "";
    cached = token ? { token, exp: decodeExp(token) } : null;
    return token;
  } catch {
    // Network error (auth service unreachable / offline). Keep an unexpired token if we still
    // hold one — better than dropping the session on a transient failure.
    if (previous && previous.exp > nowSeconds()) {
      cached = previous;
      return previous.token;
    }
    cached = null;
    return "";
  }
}

/**
 * Returns a valid JWT, or "" when unauthenticated. Concurrent callers share one in-flight
 * request; a cached token is reused until it is within 60s of expiry.
 */
export async function getAuthToken(): Promise<string> {
  if (cached && isFresh(cached)) return cached.token;
  if (inflight) return inflight;
  inflight = fetchFreshToken().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Drop the cached token. Call on sign-out so a stale JWT is never reused. */
export function clearAuthToken(): void {
  cached = null;
  inflight = null;
}
