/**
 * The CLI rows under Personalization > AI. A CLI runs where a process can be spawned, which is
 * never a browser:
 * - Desktop: one row per CLI (cli-sign-in.tsx), each installed, signed in and checked from the
 *   row itself, on the user's own machine and subscription (src-tauri/src/ai_login.rs).
 * - Browser: one row with buttons: the desktop app, and each CLI's install page. The server's own
 *   CLI (AI_CLI in .env) is the operator's and serves every user, so it is configured there, not
 *   from here.
 */
import { cliLogin, engineLabel, type AiEngineInfo } from "../../lib/ai/compose";
import { CliRow } from "./cli-sign-in";
import { CLI_TOOLS, DESKTOP_DOWNLOAD_URL } from "./cli-tools";
import { SetupRow } from "./setup-row";

export function CliSetup({ status }: { status: AiEngineInfo | null }) {
  // Present only in the desktop build.
  if (cliLogin) {
    const login = cliLogin;
    return (
      <>
        {CLI_TOOLS.map((tool) => (
          <CliRow key={tool.kind} tool={tool} login={login} />
        ))}
      </>
    );
  }
  return <BrowserCli status={status} />;
}

function BrowserCli({ status }: { status: AiEngineInfo | null }) {
  const serverCli = status?.engine.endsWith("-cli") ? engineLabel(status.engine) : null;
  return (
    <SetupRow
      label="CLI engines"
      testid="cli-tools"
      summary={serverCli ? `Server runs ${serverCli}.` : "Desktop app only."}
    >
      <a
        href={DESKTOP_DOWNLOAD_URL}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="cli-desktop-download"
        className="inline-block rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90"
      >
        Get the desktop app
      </a>
      <div className="flex flex-wrap gap-1">
        {CLI_TOOLS.map((tool) => (
          <a
            key={tool.kind}
            href={tool.installUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-line px-2 py-1 text-xs text-muted hover:bg-hover hover:text-fg"
          >
            Install {tool.label}
          </a>
        ))}
      </div>
    </SetupRow>
  );
}
