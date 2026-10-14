/**
 * "Sign in to Claude" in the desktop app: runs `claude auth login` on this computer and shows the
 * sign-in link it prints (src-tauri/src/ai_login.rs does the running).
 *
 * The CLI usually opens the browser by itself. "Open sign-in page" opens it again for when it
 * does not. The link itself is never shown or held here: Rust keeps it and opens it, so a page
 * that went wrong cannot pass it to someone else (see ai_login.rs). Some sign-in pages end on a
 * code to paste back; the field for it is there from the moment the link is ready.
 *
 * Leaving the panel cancels a sign-in still in progress: nothing on screen could finish it.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { cliLogin, refreshEngine } from "../../lib/ai/compose";
import type { CliLogin, CliLoginEvent, CliLoginStatus } from "../../lib/ai/engine-contract";

export function ClaudeSignIn() {
  // Absent in the browser build, where this is never rendered anyway.
  return cliLogin ? <SignIn login={cliLogin} /> : null;
}

type Outcome = { ok: boolean; text: string };

const failure = (error: unknown): string => (typeof error === "string" ? error : String(error));

function SignIn({ login }: { login: CliLogin }) {
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
      .status()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [login]);

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

  const onEvent = useCallback(
    (event: CliLoginEvent) => {
      if (event.kind === "link") {
        setLinkReady(true);
        return;
      }
      active.current = false;
      stopListening.current?.();
      stopListening.current = null;
      setRunning(false);
      setLinkReady(false);
      setCode("");
      setOutcome({ ok: event.ok, text: event.message });
      if (event.ok) {
        // The engine list and its default change once the CLI is signed in.
        refreshEngine();
      }
      readStatus();
    },
    [readStatus],
  );

  async function start(): Promise<void> {
    setOutcome(null);
    setLinkReady(false);
    setRunning(true);
    active.current = true;
    try {
      const unlisten = await login.start(onEvent);
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

  if (status && !status.found) return null;

  return (
    <div data-testid="claude-sign-in" className="space-y-2 rounded border border-line p-2">
      <p data-testid="claude-sign-in-status" className="text-xs text-subtle">
        {status === null
          ? "Checking sign-in…"
          : status.loggedIn
            ? `Signed in${status.email ? ` as ${status.email}` : ""}${
                status.subscription ? ` (${status.subscription})` : ""
              }.`
            : "Not signed in."}
      </p>

      {running ? (
        <div className="space-y-2">
          <p className="text-xs text-muted">Waiting for sign-in in the browser.</p>
          {linkReady ? (
            <>
              <div className="flex gap-1">
                <SmallButton onClick={() => void act(login.openLink)}>
                  Open sign-in page
                </SmallButton>
                <SmallButton onClick={() => void act(login.cancel)}>Cancel</SmallButton>
              </div>
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
            </>
          ) : (
            <SmallButton onClick={() => void act(login.cancel)}>Cancel</SmallButton>
          )}
        </div>
      ) : (
        <SmallButton onClick={() => void start()} disabled={status === null}>
          {status?.loggedIn ? "Switch account" : "Sign in to Claude"}
        </SmallButton>
      )}

      {outcome ? (
        <p role="status" className={`text-xs ${outcome.ok ? "text-subtle" : "text-danger"}`}>
          {outcome.text}
        </p>
      ) : null}
    </div>
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
