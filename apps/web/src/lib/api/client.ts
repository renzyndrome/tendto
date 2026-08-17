/** Thin fetch wrapper for the few true API calls (auth/billing/AI + sync upload).
 *  Content reads NEVER go through here — they come from the local replica. */
import { getAuthToken } from "../auth/token";

const API_URL = import.meta.env.VITE_API_URL as string;

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  // Attach the short-lived better-auth JWT (cached + auto-refreshed in getAuthToken).
  const token = await getAuthToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    throw new ApiError(res.status, await readDetail(res, init.method ?? "GET", path));
  }
  return res;
}

/** Carries the server's message so UI can show *why* something failed, not just that it did. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** FastAPI puts the human-readable reason in `detail`; fall back to a generic line. */
async function readDetail(res: Response, method: string, path: string): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail.length > 0) return body.detail;
  } catch {
    // Not JSON (proxy error page, empty body) — fall through.
  }
  return `API ${method} ${path} failed: ${res.status}`;
}
