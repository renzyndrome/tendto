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

/** How an engine name reads to a person. Unknown names show as-is rather than as "custom". */
const ENGINE_LABELS: Record<string, string> = {
  "claude-cli": "Claude CLI",
  "codex-cli": "Codex CLI",
  api: "your API key",
  offline: "no AI engine",
};

export const engineLabel = (engine: string): string => ENGINE_LABELS[engine] ?? engine;

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



/**
 * Stream a task, calling `onDelta` with each piece as it arrives.
 *
 * `fetch` + a stream reader rather than `EventSource`, which can carry neither an
 * Authorization header nor a request body. Resolves with the finished text.
 *
 * Once the response has started the server can no longer answer with a status code, so a
 * failure arrives as a final `error` event — which this turns back into a thrown Error, so
 * callers handle both kinds of failure the same way.
 */
export async function streamCompose(
  task: string,
  text: string,
  onDelta: (piece: string) => void,
  signal?: AbortSignal,
): Promise<ComposeResult> {
  const res = await apiFetch("/ai/compose/stream", {
    method: "POST",
    signal,
    body: JSON.stringify({ task, text }),
  });
  const body = res.body;
  if (!body) throw new Error("The AI engine returned nothing.");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: ComposeResult | null = null;

  const handle = (payload: string) => {
    let event: { delta?: string; done?: boolean; text?: string; truncated?: boolean; error?: string };
    try {
      event = JSON.parse(payload);
    } catch {
      return; // a frame we cannot read is not worth losing the response over
    }
    if (event.error) throw new Error(event.error);
    if (typeof event.delta === "string") onDelta(event.delta);
    if (event.done && typeof event.text === "string") {
      result = { text: event.text, engine: "stream", truncated: event.truncated ?? false };
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Frames are separated by a blank line; the last piece may be a partial frame, so it
      // stays in the buffer until the rest of it arrives.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        for (const line of frame.split("\n")) {
          if (line.startsWith("data:")) handle(line.slice("data:".length).trim());
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  if (!result) throw new Error("The AI engine returned nothing.");
  return result;
}
