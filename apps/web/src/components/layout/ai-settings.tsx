/**
 * AI engine — which machine runs the AI on this device.
 *
 * A capability, not an appearance, so it is its own row rather than a section of
 * Personalization. It exists only in the desktop build: a browser cannot spawn anything, so
 * there would be nothing to choose.
 *
 * Per device, like the notifications toggle and the recap schedule. The thing being configured
 * is what THIS machine does, and a laptop with `claude` installed and a phone with nothing have
 * no shared answer.
 *
 * Saving is explicit, matching the Personalization dialog. Nothing here previews, so there is
 * nothing to put back on Cancel beyond leaving the stored choice alone.
 */
import { useEffect, useState } from "react";

import {
  OFF_CHOICE,
  readEngineChoice,
  SERVER_CHOICE,
  writeEngineChoice,
} from "../../lib/ai/engine-choice";
import { refreshEngine, useEngineStatus, type AiEngineInfo } from "../../lib/ai/compose";

interface AiSettingsProps {
  onClose: () => void;
}

interface Option {
  value: string;
  label: string;
  note: string;
}

function options(status: AiEngineInfo): Option[] {
  const local = status.found.map((engine) => ({
    value: engine.kind,
    label: engine.label,
    // An unverified engine says what is actually unverified. "Untested" on its own reads as
    // "the output might look odd", when the thing nobody has checked is its containment: it
    // reads pages any member of the workspace can write, and it is an agent with a shell.
    note: engine.verified
      ? "Runs on this device. Uses the signed-in subscription."
      : "Runs on this device. Sandbox untested, never used by default.",
  }));
  const server = status.serverAvailable
    ? [{ value: SERVER_CHOICE, label: "TendTo server", note: "Text is sent to the server." }]
    : [];
  return [...local, ...server, { value: OFF_CHOICE, label: "Off", note: "No AI features." }];
}

/** What was found, or what was looked for and not found. */
function state(status: AiEngineInfo): string {
  if (status.found.length === 0) {
    return `No CLI found. Looked for ${status.lookedFor.join(", ")} on PATH.`;
  }
  const active = status.found.find((engine) => engine.kind === status.engine);
  return active ? `${active.label} found. ${active.binary}` : `${status.found.length} found.`;
}

export function AiSettings({ onClose }: AiSettingsProps) {
  const status = useEngineStatus();
  const [choice, setChoice] = useState<string | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /*
   * The stored choice, or, when nothing has been picked, the same default the engine itself
   * applies (engine.desktop.ts): a VERIFIED CLI if one was found, else the server, else off.
   * The two must agree, or the row would claim something the engine is not doing. Derived
   * rather than read back from `status.engine`, because that can report a name with no row —
   * "offline" is a state, not something to pick — which would leave the list with nothing
   * selected and Save writing a value that means nothing.
   */
  const stored = readEngineChoice();
  const fallback = status
    ? (status.found.find((engine) => engine.verified)?.kind ??
      (status.serverAvailable ? SERVER_CHOICE : OFF_CHOICE))
    : null;
  const selected = choice ?? stored ?? fallback;

  function save(): void {
    if (selected) writeEngineChoice(selected);
    // Every open surface asks again, or an editor already on screen would keep the old engine.
    refreshEngine();
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="AI engine"
      data-testid="ai-settings"
      onClick={onClose}
      className="fixed inset-0 z-50 flex justify-end bg-black/10 p-4"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-full w-full max-w-xs flex-col overflow-y-auto rounded-xl border border-line bg-elevated shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-fg">AI engine</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close AI settings"
            className="rounded px-2 text-subtle hover:text-fg"
          >
            ×
          </button>
        </header>

        <div className="space-y-3 px-4 py-4">
          {status === null ? (
            <p className="text-sm text-subtle">Checking…</p>
          ) : (
            <>
              <div className="space-y-1">
                {options(status).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setChoice(option.value)}
                    data-testid={`ai-engine-${option.value}`}
                    aria-pressed={selected === option.value}
                    className={`w-full rounded border px-3 py-2 text-left ${
                      selected === option.value
                        ? "border-fg bg-hover text-fg"
                        : "border-line text-muted hover:bg-hover hover:text-fg"
                    }`}
                  >
                    <span className="block text-sm">{option.label}</span>
                    <span className="block text-xs text-subtle">{option.note}</span>
                  </button>
                ))}
              </div>
              <p data-testid="ai-engine-state" className="break-all text-xs text-subtle">
                {state(status)}
              </p>
            </>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            data-testid="ai-cancel"
            className="rounded border border-line px-2 py-1 text-xs text-muted hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={selected === null || selected === stored}
            data-testid="ai-save"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
