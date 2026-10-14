/**
 * The AI section of Personalization: which engine runs AI on this device.
 *
 * Per device, like the notifications toggle and the recap schedule. The thing being configured
 * is what THIS machine does, and a laptop with `claude` installed and a phone with nothing have
 * no shared answer.
 *
 * - Desktop: every CLI found on the machine, the TendTo server, or Off.
 * - Browser: the TendTo server or Off. A browser cannot spawn a CLI, but Off is a real choice:
 *   it hides every AI feature on this device (engine.web.ts honours it).
 *
 * A draft, like the rest of the dialog: the pick is written only on Save. Below it, on both,
 * two setup rows, closed until clicked (ai-setup.tsx): the user's own API key
 * (own-key-form.tsx), which writes at once, being account data rather than a device setting;
 * and the Claude CLI steps for wherever this is running.
 */
import { engineLabel, type AiEngineInfo } from "../../lib/ai/compose";
import { OFF_CHOICE, readEngineChoice, SERVER_CHOICE } from "../../lib/ai/engine-choice";
import { isDesktop } from "../../lib/platform";
import { ClaudeCliSetup } from "./ai-setup";
import { OwnKeyForm } from "./own-key-form";

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

/** What is running, or what was looked for and not found. */
function state(status: AiEngineInfo): string {
  if (!isDesktop) {
    if (!status.serverAvailable) return "No AI engine on the server.";
    return status.available ? `Server engine: ${engineLabel(status.engine)}.` : "AI off.";
  }
  if (status.found.length === 0) {
    return `No CLI found. Looked for ${status.lookedFor.join(", ")} on PATH.`;
  }
  const active = status.found.find((engine) => engine.kind === status.engine);
  return active ? `${active.label} found. ${active.binary}` : `${status.found.length} found.`;
}

/**
 * The choice to show as selected: the draft, else the stored one, else the default the engine
 * itself applies (engine.desktop.ts): a VERIFIED CLI if one was found, else the server, else
 * off. The two must agree, or the row would claim something the engine is not doing.
 */
export function selectedEngine(status: AiEngineInfo | null, draft: string | null): string | null {
  if (draft) return draft;
  const stored = readEngineChoice();
  if (stored) return stored;
  if (!status) return null;
  return (
    status.found.find((engine) => engine.verified)?.kind ??
    (status.serverAvailable ? SERVER_CHOICE : OFF_CHOICE)
  );
}

export function AiSection({
  status,
  selected,
  onSelect,
}: {
  status: AiEngineInfo | null;
  selected: string | null;
  onSelect: (choice: string) => void;
}) {
  return (
    <div data-testid="ai-settings" className="space-y-4">
      {status === null ? (
        <p className="text-sm text-subtle">Checking…</p>
      ) : (
        <EngineChoice status={status} selected={selected} onSelect={onSelect} />
      )}
      <div className="space-y-2 border-t border-line pt-3">
        <OwnKeyForm />
        <ClaudeCliSetup status={status} />
      </div>
    </div>
  );
}

function EngineChoice({
  status,
  selected,
  onSelect,
}: {
  status: AiEngineInfo;
  selected: string | null;
  onSelect: (choice: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        {options(status).map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onSelect(option.value)}
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
    </div>
  );
}
