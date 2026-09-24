/**
 * Fetching a recap: facts from the server, prose from whichever engine this device uses.
 *
 * The recap has two halves, and only one of them has to be server work. Gathering the activity
 * reads Postgres behind a membership check and must stay there — it is also the half that works
 * on a phone. Writing the prose over that digest is the half that costs an AI call, and a
 * desktop running the user's own CLI can do it for free, without the text leaving the machine.
 *
 * So `prose: false` goes up when a local engine is active, and the local engine writes the
 * recap from `digest`. Everywhere else behaves exactly as before.
 */
import { streamCompose, loadEngineStatus } from "./ai/compose";
import { OFF_CHOICE, readEngineChoice } from "./ai/engine-choice";
import { apiFetch } from "./api/client";
import type { RecapResponse } from "./recap";

/** The recap prompt's key on /ai/status. It belongs to no menu; see the server's _RECAP_TASK. */
const RECAP_TASK = "recap";

/**
 * The local engine ran and failed. Distinct from "offline", which means the SERVER has no
 * engine — the two need different words, because the remedies have nothing in common: one is
 * an operator's .env, the other is a CLI on this machine.
 */
export const LOCAL_FAILED = "local-failed";

export interface RecapRequest {
  date?: string;
  /** null = everything so far. */
  start?: string | null;
  end?: string;
  /** The device's local date, which anchors the overdue/upcoming half. */
  today: string;
}

/**
 * One recap.
 *
 * `prose: false` asks for the facts alone and runs no engine anywhere — used by the evening
 * notification, which is built from the structured digest and never showed the prose.
 */
export async function fetchRecap(
  request: RecapRequest,
  options: { prose?: boolean } = {},
): Promise<RecapResponse> {
  const wantsProse = options.prose ?? true;
  const status = wantsProse ? await loadEngineStatus() : null;
  const local = status?.local === true && status.available;
  // "Off" means off, including for the one AI feature nobody presses a button for. Read from
  // the stored choice rather than from `available`, which is also false when the SERVER simply
  // has no engine — that case must keep asking, or the web recap would lose its prose.
  const off = readEngineChoice() === OFF_CHOICE;

  const res = await apiFetch("/ai/daily-summary", {
    method: "POST",
    body: JSON.stringify({ ...request, prose: wantsProse && !local && !off }),
  });
  const data = (await res.json()) as RecapResponse;
  if (!local || !status) return data;

  try {
    const { text } = await streamCompose(RECAP_TASK, data.digest, () => undefined);
    return { ...data, summary: text, engine: status.engine };
  } catch {
    // The digest is still a complete, honest recap, so the page keeps working. But it must not
    // say the SERVER has no engine: this user's own CLI is what failed, and "set AI_CLI in
    // .env" would send them somewhere with nothing to fix.
    return { ...data, summary: "", engine: LOCAL_FAILED };
  }
}
