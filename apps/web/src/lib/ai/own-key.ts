/**
 * A user's own AI key, kept on the server (GET/PUT/DELETE /ai/settings).
 *
 * The key is sent once, on save, and never comes back: the server returns its last four
 * characters only. Nothing here stores it in the browser. Saving or removing it changes which
 * engine serves this user, so both make every open surface ask again (`refreshEngine`).
 */
import { apiFetch } from "../api/client";
import { refreshEngine } from "./compose";

export interface AiProvider {
  key: string;
  label: string;
  default_model: string;
}

export interface OwnKeySettings {
  /** False when the server has no AI_KEYS_SECRET, so no key can be stored. */
  enabled: boolean;
  custom_allowed: boolean;
  providers: AiProvider[];
  configured: boolean;
  provider: string | null;
  model: string | null;
  base_url: string | null;
  key_hint: string | null;
  /** False when a key is stored but the server can no longer read it. */
  key_readable: boolean;
}

export interface OwnKeyInput {
  provider: string;
  model: string;
  /** Empty keeps the stored key. */
  api_key: string;
  base_url?: string;
}

export const CUSTOM_PROVIDER = "custom";

export async function loadOwnKey(): Promise<OwnKeySettings> {
  const res = await apiFetch("/ai/settings");
  return (await res.json()) as OwnKeySettings;
}

export async function saveOwnKey(input: OwnKeyInput): Promise<OwnKeySettings> {
  const res = await apiFetch("/ai/settings", {
    method: "PUT",
    body: JSON.stringify({
      provider: input.provider,
      model: input.model,
      api_key: input.api_key || null,
      base_url: input.provider === CUSTOM_PROVIDER ? (input.base_url ?? "") : null,
    }),
  });
  refreshEngine();
  return (await res.json()) as OwnKeySettings;
}

export async function removeOwnKey(): Promise<void> {
  await apiFetch("/ai/settings", { method: "DELETE" });
  refreshEngine();
}
