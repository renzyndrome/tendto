/**
 * Interactive AI — summarize a page, rewrite a selection, ask your notes (doc 06, AI-2).
 *
 * This is the face every component uses. What actually runs the inference is chosen by the
 * build: the server in the browser, the user's own CLI on the desktop. See engine-contract.ts
 * for why that seam exists and what each side does.
 *
 * Unlike everything else the editor does, this genuinely needs an engine: there is no offline
 * summary the way there is an offline recap (the recap always has a real structured digest; a
 * summary of nothing is nothing). So the UI asks first, and hides the AI entry points entirely
 * rather than offering buttons that cannot work.
 */
import { useEffect, useState } from "react";

import { engine } from "@tendto-ai-engine";

import type { AiEngineInfo } from "./engine-contract";

export type { AiTask } from "./server-status";
export type { AiEngineInfo, LocalEngine } from "./engine-contract";

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
  truncated: boolean;
}

/** What is running AI here. Memoised inside the engine, so this is cheap to call. */
export function loadEngineStatus(): Promise<AiEngineInfo> {
  return engine.describe();
}

/** Fired when the device's engine choice changes, so open surfaces re-read it. */
const CHANGED = "tendto:ai-engine-changed";

/**
 * Drop what every surface believes about the engine and make them ask again.
 *
 * Called after the AI settings row is saved. Without it, an editor that is already open would
 * keep offering the old engine until the window was reopened.
 */
export function refreshEngine(): void {
  engine.forget();
  window.dispatchEvent(new Event(CHANGED));
}

/** The active engine, or null while it is still being worked out. */
export function useEngineStatus(enabled = true): AiEngineInfo | null {
  const [status, setStatus] = useState<AiEngineInfo | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () => {
      void loadEngineStatus().then((next) => {
        if (!cancelled) setStatus(next);
      });
    };
    load();
    window.addEventListener(CHANGED, load);
    return () => {
      cancelled = true;
      window.removeEventListener(CHANGED, load);
    };
  }, [enabled]);

  return status;
}

/**
 * Stream a task, calling `onDelta` with each piece as it arrives. Resolves with the finished
 * text, and rejects on any failure so callers handle one kind of error rather than two.
 */
export function streamCompose(
  task: string,
  text: string,
  onDelta: (piece: string) => void,
  signal?: AbortSignal,
  /** Only for a search-scoped task: `text` carries the sources, this carries what to ask. */
  options?: { question?: string },
): Promise<ComposeResult> {
  return engine.run({ task, text, question: options?.question }, onDelta, signal);
}
