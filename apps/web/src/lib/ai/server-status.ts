/**
 * What the server says about AI: which engine it has, and the curated task list with prompts.
 *
 * Split out of compose.ts so the two engine implementations (engine.web / engine.desktop) can
 * both read it without importing each other's module.
 *
 * The task list is CACHED to localStorage, which is not an optimisation. A desktop user running
 * their own CLI needs the system prompts to build a prompt, and those prompts live on the
 * server; without a cache, local AI would stop working on a plane. In a local-first app that
 * would be a bad joke.
 */
import { apiFetch } from "../api/client";

export interface AiTask {
  key: string;
  label: string;
  /** True for tasks that act on the whole page rather than a selection (today: summarize). */
  whole_document: boolean;
  /**
   * Which surface offers this task. "editor" tasks rewrite text the user selected; "search"
   * tasks answer a question about the workspace and belong in the command palette; "recap" is
   * the evening summary's prompt, which belongs to no menu and is carried only so a local
   * engine can write the recap itself. Each surface matches its OWN value, so a task added
   * server-side cannot appear anywhere by default.
   */
  scope: "editor" | "search" | "recap";
  /**
   * The system prompt, owned by the server (app/ai/compose.py). A local engine sends this
   * verbatim. It carries the injection rule, which matters most exactly here: the engine is an
   * agentic CLI, and the text can be something a colleague wrote in a shared workspace.
   */
  system: string;
}

export interface ServerStatus {
  engine: string;
  available: boolean;
  tasks: AiTask[];
  /** app.ai.compose.USER_TEXT_MARKER — the line a local engine puts before the user's text. */
  user_text_marker: string;
}

const CACHE_KEY = "tendto:ai-tasks";

const UNAVAILABLE: ServerStatus = {
  engine: "offline",
  available: false,
  tasks: [],
  user_text_marker: "",
};

let pending: Promise<ServerStatus> | null = null;

/**
 * The server's AI status, fetched once per session.
 *
 * Offline or erroring falls back to the cached prompts with `available: false`: the SERVER
 * cannot run anything, but a local engine still has everything it needs. The failure itself is
 * never memoised — a blip on first paint would otherwise hide AI until the tab is reloaded.
 */
export function loadServerStatus(): Promise<ServerStatus> {
  if (!pending) {
    pending = apiFetch("/ai/status")
      .then((res) => res.json() as Promise<ServerStatus>)
      .then((status) => {
        cache(status);
        return status;
      })
      .catch(() => {
        pending = null;
        return { ...UNAVAILABLE, ...cached() };
      });
  }
  return pending;
}

/** Drop the memo so the next read goes back to the server. */
export function forgetServerStatus(): void {
  pending = null;
}

function cache(status: ServerStatus): void {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ tasks: status.tasks, user_text_marker: status.user_text_marker }),
    );
  } catch {
    // Storage unavailable: local AI then needs the network on its first run of a session.
  }
}

/**
 * The last task list this device saw, validated. Empty when there is nothing usable.
 *
 * These prompts are handed to an agentic CLI, so the cache is treated as untrusted input
 * rather than as something we wrote. A prompt that does not name the marker cannot be the
 * server's, and is dropped: better no local AI than local AI running an unknown prompt.
 */
function cached(): Partial<ServerStatus> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<ServerStatus>;
    const marker =
      typeof parsed.user_text_marker === "string" ? parsed.user_text_marker : "";
    if (!marker) return {};
    const tasks = Array.isArray(parsed.tasks)
      ? parsed.tasks.filter((task) => isTask(task, marker))
      : [];
    if (tasks.length === 0) return {};
    return { tasks, user_text_marker: marker };
  } catch {
    return {};
  }
}

function isTask(value: unknown, marker: string): value is AiTask {
  const task = value as Partial<AiTask> | null;
  return (
    typeof task?.key === "string" &&
    typeof task.label === "string" &&
    typeof task.system === "string" &&
    // Every server prompt ends with the injection rule, which names the marker.
    task.system.includes(marker)
  );
}
