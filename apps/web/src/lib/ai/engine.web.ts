/**
 * Browser implementation of the AI engine seam (see engine-contract.ts).
 *
 * Inference happens on the server, over an engine the operator configured. This is the whole of
 * today's behaviour, moved rather than changed: `streamCompose` used to live in compose.ts and
 * its body is unchanged below.
 *
 * The desktop build imports this file too, as its fallback for a machine with no CLI — so
 * nothing here may reference Tauri.
 */
import { apiFetch } from "../api/client";
import type { AiEngine, AiEngineInfo, AiRunRequest, AiRunResult } from "./engine-contract";
import { forgetServerStatus, loadServerStatus } from "./server-status";

/** The server's status, shaped as an engine description. Shared with the desktop fallback. */
export async function describeServer(): Promise<AiEngineInfo> {
  const status = await loadServerStatus();
  return {
    engine: status.engine,
    available: status.available,
    tasks: status.tasks,
    local: false,
    found: [],
    lookedFor: [],
    serverAvailable: status.available,
  };
}

/**
 * Stream a task through the server, calling `onDelta` with each piece as it arrives.
 *
 * `fetch` + a stream reader rather than `EventSource`, which can carry neither an
 * Authorization header nor a request body. Resolves with the finished text.
 *
 * Once the response has started the server can no longer answer with a status code, so a
 * failure arrives as a final `error` event — which this turns back into a thrown Error, so
 * callers handle both kinds of failure the same way.
 */
export async function runOnServer(
  request: AiRunRequest,
  onDelta: (piece: string) => void,
  signal?: AbortSignal,
): Promise<AiRunResult> {
  const res = await apiFetch("/ai/compose/stream", {
    method: "POST",
    signal,
    body: JSON.stringify({
      task: request.task,
      text: request.text,
      question: request.question,
    }),
  });
  const body = res.body;
  if (!body) throw new Error("The AI engine returned nothing.");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: AiRunResult | null = null;

  const handle = (payload: string) => {
    let event: {
      delta?: string;
      done?: boolean;
      text?: string;
      truncated?: boolean;
      error?: string;
    };
    try {
      event = JSON.parse(payload);
    } catch {
      return; // a frame we cannot read is not worth losing the response over
    }
    if (event.error) throw new Error(event.error);
    if (typeof event.delta === "string") onDelta(event.delta);
    if (event.done && typeof event.text === "string") {
      result = { text: event.text, truncated: event.truncated ?? false };
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

export const engine: AiEngine = {
  describe: describeServer,
  run: runOnServer,
  forget: forgetServerStatus,
};
