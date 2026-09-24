/**
 * Which engine this DEVICE uses for AI.
 *
 * Per device, like the notifications toggle and the recap schedule, and for the same reason:
 * the thing being configured is what this machine does. A laptop with `claude` installed and a
 * phone with nothing have no shared answer.
 */

const KEY = "tendto:ai-engine";

/** "server" sends text to the operator's engine; "off" hides AI entirely on this device. */
export type EngineChoice = string;

export const SERVER_CHOICE = "server";
export const OFF_CHOICE = "off";

/** The stored choice, or null when nothing has been picked and the default applies. */
export function readEngineChoice(): EngineChoice | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw && raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

export function writeEngineChoice(choice: EngineChoice): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Storage unavailable: the choice just won't survive a restart.
  }
}
