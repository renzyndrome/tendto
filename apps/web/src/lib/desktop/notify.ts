/**
 * Native-notification bridge. The web and desktop builds ship the SAME bundle, so this must be
 * safe in a plain browser: inside the Tauri desktop shell it fires an OS notification via the Rust
 * `notify_interval_ended` command; in a browser it is a no-op.
 *
 * We call Tauri's injected global directly (`window.__TAURI_INTERNALS__.invoke`) rather than
 * importing `@tauri-apps/api`, so the web app needs no Tauri dependency and this file typechecks
 * and tree-shakes cleanly. (Inside apps/desktop's own code the sanctioned API is
 * `@tauri-apps/api/core`'s `invoke`.)
 */
import type { FocusPhase } from "../../stores/focus";

interface TauriInternals {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

function tauriInternals(): TauriInternals | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __TAURI_INTERNALS__?: TauriInternals };
  return w.__TAURI_INTERNALS__ ?? null;
}

/** True only inside the Tauri desktop webview. */
export function isTauri(): boolean {
  return tauriInternals() !== null;
}

/** Fire a native notification for the focus phase that just ended. No-op in the browser. */
export async function notifyPhaseEnded(phase: FocusPhase): Promise<void> {
  const internals = tauriInternals();
  if (!internals) return;
  try {
    await internals.invoke("notify_interval_ended", { phase });
  } catch (err) {
    // Never let a notification failure break the timer.
    console.error("notifyPhaseEnded failed", err);
  }
}
