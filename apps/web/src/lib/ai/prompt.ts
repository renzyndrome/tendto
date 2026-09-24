/**
 * Prompt assembly for a LOCAL engine — a faithful port of the server's `_prepare`.
 *
 * On the web path the server builds all of this and the client sends only the raw text. A local
 * engine has no server in the loop, so the assembly has to happen here instead. That makes this
 * file a second copy of something that must not drift, so it is deliberately small and it
 * copies rather than improvises:
 *
 *   - `app/routers/ai.py::_prepare` — the order of question, marker and sources,
 *   - `app/ai/compose.py::truncate` — where an over-long page is clipped,
 *   - `app/ai/compose.py::clean` — the code fence a model adds despite being told not to.
 *
 * The system prompts themselves are NOT copied. They arrive from /ai/status, so the injection
 * rule stays owned by one place. Change either side of this and change the other.
 */
import type { AiTask } from "./server-status";

/** app.ai.compose.MAX_INPUT_CHARS. */
export const MAX_INPUT_CHARS = 20_000;

/** Clip over-long input at a word boundary. Returns the text and whether it was clipped. */
export function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_INPUT_CHARS) return { text, truncated: false };
  const clipped = text.slice(0, MAX_INPUT_CHARS);
  const space = clipped.lastIndexOf(" ");
  // Back up to the last space, unless that would throw away most of the page.
  return {
    text: space > MAX_INPUT_CHARS / 2 ? clipped.slice(0, space) : clipped,
    truncated: true,
  };
}

/**
 * The user message for one task.
 *
 * For a search task the question goes BEFORE the marker and the sources after it, so the
 * injection rule covers the retrieved notes — extracts that can come from any page in a shared
 * workspace, which is precisely the text that must never be read as instructions.
 */
export function buildUserMessage(
  task: AiTask,
  text: string,
  marker: string,
  question?: string,
): { message: string; truncated: boolean } {
  const sources = truncate(text);
  const wrapped = `${marker}\n${sources.text}`;
  const message =
    task.scope === "search"
      ? `Question:\n${(question ?? "").trim()}\n\nSources:\n${wrapped}`
      : wrapped;

  /*
   * Checked at run time, not in a test, because apps/web has no unit-test runner: nothing
   * anywhere would fail if this order were quietly changed, and half the injection defence
   * would be gone on the one path where the engine is an agentic CLI. Failing loudly beats
   * running an unprotected prompt.
   *
   * The marker must be present, and for a search task everything the user asked must sit
   * BEFORE it — the sources after the marker are extracts from pages anyone in the workspace
   * can write, and the marker is what disowns them as instructions.
   */
  const at = message.indexOf(marker);
  if (!marker || at < 0) throw new Error("Prompt assembly lost the user-text marker.");
  if (task.scope === "search" && !message.slice(0, at).includes("Question:")) {
    throw new Error("Prompt assembly put the sources ahead of the question.");
  }

  return { message, truncated: sources.truncated };
}

/**
 * Strip the wrappers models add despite being asked not to.
 *
 * Belt and braces, same as the server: a stray ```-fence pasted into someone's document is far
 * more annoying than a redundant check here.
 */
export function clean(text: string): string {
  const out = text.trim();
  if (!out.startsWith("```")) return out;
  const lines = out.split(/\r?\n/);
  if (lines.length < 2) return out;
  const body = lines.slice(1);
  if (body.length > 0 && body[body.length - 1].trimStart().startsWith("```")) body.pop();
  return body.join("\n").trim();
}
