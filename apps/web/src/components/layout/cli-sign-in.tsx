/**
 * One CLI's row in the desktop app's AI section: whether it is installed and signed in, and the
 * buttons that change that (src-tauri/src/ai_login.rs does the running).
 *
 * - Not installed: "Install guide" opens its install page; "Check again" looks for it again.
 * - Signs in through a link (claude, codex): "Sign in" runs the CLI's own sign-in. The CLI
 *   usually opens the browser itself; "Open sign-in page" opens it again for when it does not.
 *   The link itself is never shown or held here: Rust keeps it and opens it, so a page that went
 *   wrong cannot pass it to someone else. A code field covers a page that ends on a code.
 * - Signs in through its own screen (gemini): "Sign in" opens it in a terminal.
 *
 * Leaving the panel cancels a sign-in still in progress: nothing on screen could finish it.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { refreshEngine } from "../../lib/ai/compose";
import type { CliLogin, CliLoginEvent, CliLoginStatus } from "../../lib/ai/engine-contract";
import { SetupRow } from "./setup-row";
import type { CliTool } from "./cli-tools";

type Outcome = { ok: boolean; text: string };

const failure = (error: unknown): string => (typeof error === "string" ? error : String(error));

function summarize(status: CliLoginStatus | null): string {
  if (status === null) return "Checking…";
  if (!status.found) return "Not found on this computer.";
  if (!status.known) return "Installed. Sign-in state not reported.";
  if (!status.loggedIn) return "Not signed in.";
  const who = status.email ? ` as ${status.email}` : "";
  const plan = status.subscription ? ` (${status.subscription})` : "";
  return `Signed in${who}${plan}.`;
}

export function CliRow({ tool, login }: { tool: CliTool; login: CliLogin }) {
  const [status, setStatus] = useState<CliLoginStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [linkReady, setLinkReady] = useState(false);
  const [code, setCode] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const stopListening = useRef<(() => void) | null>(null);
  // Whether a sign-in is still going, read where state would be stale: the CLI can end before
  // `login.start` has even returned its listener.
  const active = useRef(false);

  const readStatus = useCallback(() => {
    login
      .status(tool.kind)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [login, tool.kind]);

  useEffect(() => {
    readStatus();
    return () => {
      // Also while `login.start` is still on its way: the CLI must not outlive the panel.
      if (!active.current) return;
      active.current = false;
      stopListening.current?.();
      stopListening.current = null;
      void login.cancel().catch(() => undefined);
    };
  }, [login, readStatus]);

  const finish = useCallback((result: Outcome) => {
    active.current = false;
    stopListening.current?.();
    stopListening.current = null;
    setRunning(false);
    setLinkReady(false);
    setCode("");
    setOutcome(result);
  }, []);

  const onEvent = useCallback(
    (event: CliLoginEvent) => {
      if (event.cli !== tool.kind) {
        // Another CLI's sign-in replaced this one: one runs at a time.
        if (active.current) finish({ ok: false, text: "Sign-in stopped. Another one started." });
        return;
      }
      if (event.kind === "link") {
        setLinkReady(true);
        return;
      }
      finish({ ok: event.ok, text: event.message });
      // The engine list and its default change once a CLI is signed in.
      if (event.ok) refreshEngine();
      readStatus();
    },
    [tool.kind, finish, readStatus],
  );

  async function signIn(): Promise<void> {
    setOutcome(null);
    if (tool.signIn === "terminal") {
      await act(async () => {
        await login.openTerminal(tool.kind);
        setOutcome({ ok: true, text: "Terminal opened. Finish the sign-in there." });
      });
      return;
    }
    setLinkReady(false);
    setRunning(true);
    active.current = true;
    try {
      const unlisten = await login.start(tool.kind, onEvent);
      if (active.current) stopListening.current = unlisten;
      else unlisten();
    } catch (error) {
      active.current = false;
      setRunning(false);
      setOutcome({ ok: false, text: failure(error) });
    }
  }

  async function act(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      setOutcome({ ok: false, text: failure(error) });
    }
  }

  function checkAgain(): void {
    setStatus(null);
    refreshEngine();
    readStatus();
  }

  return (
    <SetupRow label={tool.label} summary={summarize(status)} testid={`cli-${tool.kind}`}>
      {status && !status.found ? (
        <div className="flex flex-wrap gap-1">
          <SmallButton onClick={() => void act(() => login.openInstallPage(tool.kind))}>
            Install guide
          </SmallButton>
          <SmallButton onClick={checkAgain}>Check again</SmallButton>
        </div>
      ) : running ? (
        <div className="space-y-2">
          <p className="text-xs text-muted">Waiting for sign-in in the browser.</p>
          <div className="flex flex-wrap gap-1">
            {linkReady ? (
              <SmallButton onClick={() => void act(login.openLink)}>Open sign-in page</SmallButton>
            ) : null}
            <SmallButton onClick={() => void act(login.cancel)}>Cancel</SmallButton>
          </div>
          {linkReady ? (
            <form
              className="flex gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                void act(() => login.submitCode(code)).then(() => setCode(""));
              }}
            >
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                aria-label="Code from the sign-in page"
                placeholder="Code, if the page shows one"
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 rounded border border-line bg-app px-2 py-1 text-xs text-fg outline-none placeholder:text-subtle focus:border-muted"
              />
              <button
                type="submit"
                disabled={!code.trim()}
                className="rounded border border-line px-2 py-1 text-xs text-muted hover:bg-hover hover:text-fg disabled:opacity-50"
              >
                Send code
              </button>
            </form>
          ) : null}
        </div>
      ) : (
        <SmallButton onClick={() => void signIn()} disabled={status === null}>
          {status?.loggedIn ? "Switch account" : "Sign in"}
        </SmallButton>
      )}

      {outcome ? (
        <p role="status" className={`text-xs ${outcome.ok ? "text-subtle" : "text-danger"}`}>
          {outcome.text}
        </p>
      ) : null}
    </SetupRow>
  );
}

function SmallButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-line px-2 py-1 text-xs text-muted hover:bg-hover hover:text-fg disabled:opacity-50"
    >
      {children}
    </button>
  );
}
