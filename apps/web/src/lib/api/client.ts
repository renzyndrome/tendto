/** Thin fetch wrapper for the few true API calls (auth/billing/AI + sync upload).
 *  Content reads NEVER go through here — they come from the local replica. */
import { getAuthToken } from "../auth/token";

const API_URL = import.meta.env.VITE_API_URL as string;

/** Error thrown by apiFetch on a non-2xx response; carries the HTTP status so callers (e.g. the
 *  sync connector) can distinguish a retry-worthy failure from a permanent rejection. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

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
    throw new ApiError(res.status, `API ${init.method ?? "GET"} ${path} failed: ${res.status}`);
  }
  return res;
}
