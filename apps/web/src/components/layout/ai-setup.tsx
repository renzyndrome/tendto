/**
 * The setup rows under Personalization > AI: closed until clicked, so nothing asks for a key or
 * a command before someone has chosen to set one up.
 *
 * `SetupRow` is the shared disclosure; `ClaudeCliSetup` is the Claude CLI row. The CLI runs where
 * a process can be spawned, which is never a browser:
 * - Desktop: the user's own `claude`, found on this computer (src-tauri/src/ai.rs), and signed
 *   in from the row itself (claude-sign-in.tsx).
 * - Server: the operator's, through AI_CLI in .env. One subscription then serves every user,
 *   which is a self-host arrangement only (see app/ai/provider.py).
 */
import { useState, type ReactNode } from "react";

import { refreshEngine, type AiEngineInfo } from "../../lib/ai/compose";
import { isDesktop } from "../../lib/platform";
import { ClaudeSignIn } from "./claude-sign-in";
import { ChevronIcon } from "./tree-icons";

export function SetupRow({
  label,
  summary,
  testid,
  children,
}: {
  label: string;
  /** One line shown open or closed: what is set up now. */
  summary?: string | null;
  testid: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid={testid} className="space-y-1">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        data-testid={`${testid}-toggle`}
        className="flex w-full items-center justify-between rounded px-1 py-1 text-left text-sm text-fg hover:bg-hover/60"
      >
        {label}
        <ChevronIcon open={open} className="h-3.5 w-3.5 shrink-0 text-subtle" />
      </button>
      {summary ? (
        <p data-testid={`${testid}-summary`} className="px-1 text-xs text-subtle">
          {summary}
        </p>
      ) : null}
      {open ? <div className="space-y-2 px-1 pt-1">{children}</div> : null}
    </div>
  );
}

const INSTALL = "npm install -g @anthropic-ai/claude-code";

export function ClaudeCliSetup({ status }: { status: AiEngineInfo | null }) {
  const found = status?.found.find((engine) => engine.kind === "claude-cli");
  const summary = isDesktop
    ? found
      ? `Found: ${found.binary}`
      : "Not found on this computer."
    : status?.engine === "claude-cli"
      ? "Server runs Claude CLI."
      : "Runs in the desktop app.";

  return (
    <SetupRow label="Claude CLI" summary={summary} testid="claude-cli">
      {isDesktop ? <DesktopSteps /> : <BrowserSteps />}
    </SetupRow>
  );
}

/** Install and sign in on this computer, then look again. */
function DesktopSteps() {
  return (
    <>
      <Steps
        items={[
          <>
            Install: <Command>{INSTALL}</Command>
          </>,
          <>
            Sign in below, or run <Command>claude auth login</Command> in a terminal.
          </>,
          <>Pick Claude CLI above. After a fresh install: Check again first.</>,
        ]}
      />
      <ClaudeSignIn />
      <button
        type="button"
        onClick={refreshEngine}
        data-testid="claude-cli-recheck"
        className="rounded border border-line px-2 py-1 text-xs text-muted hover:bg-hover hover:text-fg"
      >
        Check again
      </button>
    </>
  );
}

/** A browser cannot run a CLI: the two places that can. */
function BrowserSteps() {
  return (
    <>
      <p className="text-xs font-medium text-fg">Desktop app, on its own subscription</p>
      <Steps
        items={[
          <>
            Install: <Command>{INSTALL}</Command>
          </>,
          <>Open the TendTo desktop app. Sign in under Personalization, AI, Claude CLI.</>,
          <>Pick Claude CLI there.</>,
        ]}
      />
      <p className="pt-1 text-xs font-medium text-fg">Server, self-host only</p>
      <Steps
        items={[
          <>
            Sign in to claude on the server: <Command>claude auth login</Command>.
          </>,
          <>
            Set <Command>AI_CLI=claude</Command> in the server&apos;s .env, then restart the API.
          </>,
          <>One subscription then serves every user of the server.</>,
        ]}
      />
    </>
  );
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="list-decimal space-y-1 pl-5 text-xs text-muted">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ol>
  );
}

function Command({ children }: { children: string }) {
  return (
    <code className="break-all rounded bg-app px-1 py-0.5 font-mono text-[0.7rem] text-fg">
      {children}
    </code>
  );
}
