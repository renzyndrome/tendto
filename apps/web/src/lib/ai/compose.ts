/**
 * Interactive AI — summarize a page, rewrite a selection (doc 06, AI-2).
 *
 * Unlike everything else the editor does, this genuinely needs the network and a configured
 * engine: there is no offline summary the way there is an offline recap (the recap always has
 * a real structured digest; a summary of nothing is nothing). So the UI asks first, and hides
 * the AI entry points entirely rather than offering buttons that cannot work.
 */
import { apiFetch } from "../api/client";

export interface AiTask {
  key: string;
  label: string;
  /** True for tasks that act on the whole page rather than a selection (today: summarize). */
  whole_document: boolean;
}

export interface EngineStatus {
  engine: string;
  available: boolean;
  tasks: AiTask[];
}

export interface ComposeResult {
  text: string;
  engine: string;
  truncated: boolean;
}

/** Whether an engine is configured is operator config — it cannot change under a running tab,
 *  so it is fetched once per session and shared, like the member roster. */
let pending: Promise<EngineStatus> | null = null;

const UNAVAILABLE: EngineStatus = { engine: "offline", available: false, tasks: [] };

export function loadEngineStatus(): Promise<EngineStatus> {
  if (!pending) {
    pending = apiFetch("/ai/status")
      .then((res) => res.json() as Promise<EngineStatus>)
      // Offline or erroring: behave exactly as if no engine were configured. The features
      // disappear; nothing breaks. Crucially the FAILURE is not cached — a blip on first paint
      // (or a token that was not minted yet) would otherwise hide AI until the tab is reloaded.
      .catch(() => {
        pending = null;
        return UNAVAILABLE;
      });
  }
  return pending;
}

/** Forget the cached answer — only useful if the server's configuration changed under us. */
export function resetEngineStatus(): void {
  pending = null;
}

export async function compose(task: string, text: string): Promise<ComposeResult> {
  const res = await apiFetch("/ai/compose", {
    method: "POST",
    body: JSON.stringify({ task, text }),
  });
  return (await res.json()) as ComposeResult;
}
