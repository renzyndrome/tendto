/**
 * Desktop implementation of the AI engine seam (see engine-contract.ts).
 *
 * The one thing a browser cannot do: spawn the `claude` or `codex` binary the user already
 * installed and signed into. Inference then runs on their machine, on their own subscription,
 * and their text never reaches the server at all.
 *
 * Three rules shape this file:
 *
 *   1. **Fall back, always.** No CLI found, or the server picked deliberately, and this behaves
 *      exactly like the browser build. A desktop user is never worse off than a web user.
 *   2. **The prompts come from the server** (see server-status.ts). They carry the injection
 *      rule, and a second copy is a copy that can be forgotten.
 *   3. **The binary is spawned, not an SDK embedded.** Usage through the installed CLI draws on
 *      the subscription; going through the agent SDK draws on a separate, pricier credit pool.
 *      The whole point is that the user's existing plan pays for this.
 *
 * The heavy lifting, and all of the containment, is in apps/desktop/src-tauri/src/ai.rs.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type {
  AiEngine,
  AiEngineInfo,
  AiRunRequest,
  AiRunResult,
  LocalEngine,
} from "./engine-contract";
import { OFF_CHOICE, readEngineChoice, SERVER_CHOICE } from "./engine-choice";
import { describeServer, runOnServer } from "./engine.web";
import { buildUserMessage, clean } from "./prompt";
import { forgetServerStatus, loadServerStatus, type AiTask } from "./server-status";

interface Detection {
  engines: LocalEngine[];
  lookedFor: string[];
}

interface DeltaEvent {
  runId: string;
  text: string;
}

/** The same shape `fetch` throws on an aborted signal, so callers handle one kind of abort. */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

let pending: Promise<AiEngineInfo> | null = null;

function describe(): Promise<AiEngineInfo> {
  if (!pending) {
    pending = build().catch((error) => {
      // Never memoise a failure: a blip at startup would hide AI until the app is restarted.
      pending = null;
      throw error;
    });
  }
  return pending;
}

async function build(): Promise<AiEngineInfo> {
  // Both halves are wanted whichever engine wins: the server still supplies the prompts, and
  // the settings row still lists every CLI found even when the server is the active engine.
  const [server, detection] = await Promise.all([
    describeServer(),
    invoke<Detection>("ai_detect").catch(
      (): Detection => ({ engines: [], lookedFor: [] }),
    ),
  ]);
  const found = detection.engines;
  const shared = {
    tasks: server.tasks,
    found,
    lookedFor: detection.lookedFor,
    serverAvailable: server.available,
  };

  const choice = readEngineChoice();
  if (choice === OFF_CHOICE) {
    return { engine: "offline", available: false, local: false, ...shared };
  }

  /*
   * With nothing chosen, a VERIFIED CLI that is present wins. Deliberate: it is the user's own
   * subscription, it costs the operator nothing, and it is the only option where the text never
   * leaves the machine. The AI settings row states what is running, so this is a default rather
   * than a surprise.
   *
   * An unverified one never wins by default, and that is a safety rule rather than a taste one.
   * Its containment has not been checked against a real install, and what it would be reading is
   * text any member of a shared workspace can write. Choosing it has to be a decision someone
   * made on purpose.
   *
   * A choice naming a CLI that is no longer installed falls through to the server, rather than
   * failing.
   */
  const local =
    choice === SERVER_CHOICE
      ? undefined
      : (found.find((engine) => engine.kind === choice) ??
        (choice ? undefined : found.find((engine) => engine.verified)));

  if (local) {
    return { engine: local.kind, available: true, local: true, ...shared };
  }
  return { engine: server.engine, available: server.available, local: false, ...shared };
}

async function run(
  request: AiRunRequest,
  onDelta: (piece: string) => void,
  signal?: AbortSignal,
): Promise<AiRunResult> {
  const info = await describe();
  if (!info.local) return runOnServer(request, onDelta, signal);

  const status = await loadServerStatus();
  // Both awaits above can outlive the request. `addEventListener("abort", …)` never fires on a
  // signal that has ALREADY aborted, so without this a cancelled run would still spawn a CLI
  // and hold the single Rust slot for up to two minutes — making the user's next AI action
  // look like a hang. The AI panel aborts the previous run on every task click, so this is one
  // fast double-click away.
  throwIfAborted(signal);
  const task = info.tasks.find((candidate) => candidate.key === request.task);
  if (!task || !status.user_text_marker) {
    // Only reachable before this device has ever reached the server, since the prompts and the
    // marker are cached together on the first successful status call.
    throw new Error("AI prompts not downloaded. Connect once, then retry.");
  }

  const { message, truncated } = buildUserMessage(
    task,
    request.text,
    status.user_text_marker,
    request.question,
  );
  const text = await runLocal(info.engine, task, message, onDelta, signal);
  return { text, truncated };
}

async function runLocal(
  kind: string,
  task: AiTask,
  user: string,
  onDelta: (piece: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const runId = crypto.randomUUID();
  // Registered BEFORE the run starts, or the first pieces are emitted into nothing.
  const unlisten = await listen<DeltaEvent>("ai://delta", (event) => {
    if (event.payload.runId === runId) onDelta(event.payload.text);
  });
  const cancel = () => {
    void invoke("ai_cancel", { runId }).catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel);
  try {
    // Aborted while the listener was being registered: nothing has been spawned yet.
    throwIfAborted(signal);
    // The finished text is the RETURN value, not a final event, so there is no race between
    // the last delta and the end of the run. Deltas are for watching it arrive; this is the
    // answer. A rejection carries the CLI's own message, which is worth showing: it is the
    // user's own machine, and "claude not found on PATH" is the fix.
    const text = await invoke<string>("ai_run", {
      runId,
      kind,
      system: task.system,
      user,
    });
    const out = clean(text);
    if (!out) throw new Error("The AI engine returned nothing.");
    return out;
  } finally {
    signal?.removeEventListener("abort", cancel);
    unlisten();
  }
}

export const engine: AiEngine = {
  describe,
  run,
  forget() {
    pending = null;
    forgetServerStatus();
  },
};
