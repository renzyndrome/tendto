/** Thin fetch wrapper for the few true API calls (auth/billing/AI + sync upload).
 *  Content reads NEVER go through here — they come from the local replica. */

const API_URL = import.meta.env.VITE_API_URL as string;

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  // TODO(phase-0): attach Clerk JWT
  // const token = await window.Clerk?.session?.getToken();
  const token = "";
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`API ${init.method ?? "GET"} ${path} failed: ${res.status}`);
  }
  return res;
}
