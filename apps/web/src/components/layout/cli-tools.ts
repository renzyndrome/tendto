/**
 * The coding-agent CLIs the AI section offers, and where each one is installed from.
 *
 * Kept in step with `LOGINS` in apps/desktop/src-tauri/src/ai_login.rs. The desktop app opens
 * these install pages from Rust, by kind; the browser links them directly.
 */
export interface CliTool {
  /** Matches the engine names: "claude-cli", "codex-cli", "gemini-cli". */
  kind: string;
  label: string;
  installUrl: string;
  /**
   * "link": a sign-in command that prints a link (claude, codex).
   * "terminal": signs in only through its own screen, opened in a terminal (gemini).
   */
  signIn: "link" | "terminal";
}

export const CLI_TOOLS: readonly CliTool[] = [
  {
    kind: "claude-cli",
    label: "Claude Code",
    installUrl: "https://docs.claude.com/en/docs/claude-code/setup",
    signIn: "link",
  },
  {
    kind: "codex-cli",
    label: "Codex",
    installUrl: "https://developers.openai.com/codex/cli",
    signIn: "link",
  },
  {
    kind: "gemini-cli",
    label: "Gemini CLI",
    installUrl: "https://geminicli.com/docs/get-started",
    signIn: "terminal",
  },
];

/**
 * Where the desktop app is downloaded. Set per deployment at build time, since a desktop build
 * carries its backend's URLs; this repository's releases otherwise.
 */
export const DESKTOP_DOWNLOAD_URL: string =
  (import.meta.env.VITE_DESKTOP_DOWNLOAD_URL as string | undefined) ||
  "https://github.com/renzyndrome/tendto/releases/latest";
