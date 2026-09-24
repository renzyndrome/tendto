/**
 * The second platform seam, and it exists for the same reason as the first one
 * (lib/powersync/platform-contract.ts): one implementation is compiled into a build, so the
 * browser bundle never carries Tauri code.
 *
 * What differs between the two builds is WHERE inference happens:
 *
 *   - **Browser**: the server runs it, on whatever engine the operator configured. With none
 *     configured the AI affordances simply never render, which is already how the app behaves.
 *   - **Desktop**: the `claude` or `codex` binary the user installed and signed into runs it,
 *     on their own machine, over their own text. The operator pays nothing and the text never
 *     leaves the device. When no CLI is found, or the user picks the server, the desktop build
 *     falls back to exactly the browser behaviour — a desktop user is never worse off.
 *
 * Vite aliases `@tendto-ai-engine` to one of the two files per build mode. Both are typed
 * against `AiEngine` below, which is what stops them drifting apart.
 */
import type { AiTask } from "./server-status";

/** One coding-agent CLI found on this machine. Always empty in the browser. */
export interface LocalEngine {
  /** Matches the server's engine names: "claude-cli", "codex-cli". */
  kind: string;
  label: string;
  /** The absolute path that was found, for the settings row. */
  binary: string;
  /**
   * Whether this CLI's argv and its containment have been checked against a real install.
   * An unverified engine is offered but never chosen by default (see engine.desktop.ts):
   * picking an agentic CLI nobody has tested, to read text a colleague wrote, is a decision.
   */
  verified: boolean;
}

/** What is running AI here, and what it can do. */
export interface AiEngineInfo {
  /** "claude-cli" | "codex-cli" | the server's engine name | "offline". */
  engine: string;
  /** False hides every AI affordance rather than showing buttons that cannot work. */
  available: boolean;
  tasks: AiTask[];
  /** True when inference happens on this machine. Drives the recap split. */
  local: boolean;
  /** Every local engine found, for the settings picker. */
  found: LocalEngine[];
  /** Binary names that were probed, found or not, so settings can say what it looked for. */
  lookedFor: string[];
  /** True when the server has an engine of its own, so "TendTo server" is worth offering. */
  serverAvailable: boolean;
}

export interface AiRunRequest {
  /** A task key from `AiEngineInfo.tasks`. */
  task: string;
  text: string;
  /** Only for a search-scoped task: `text` carries the sources, this carries what to ask. */
  question?: string;
}

export interface AiRunResult {
  text: string;
  /** True when the input hit the input limit, so the UI can say the answer covers only part. */
  truncated: boolean;
}

export interface AiEngine {
  /** What can run here. Asked once per session; `forget()` drops the answer. */
  describe(): Promise<AiEngineInfo>;

  /** Stream one task, calling `onDelta` with each piece. Rejects on any failure. */
  run(
    request: AiRunRequest,
    onDelta: (piece: string) => void,
    signal?: AbortSignal,
  ): Promise<AiRunResult>;

  /** Forget the cached description, after the engine choice changes. */
  forget(): void;
}
