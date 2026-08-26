/**
 * The Ask AI panel — pick a task, see the result, keep it or throw it away.
 *
 * Nothing is written to the document until "Keep" is pressed. That is the whole design: AI here
 * proposes, the user disposes. A tool that edits your paragraph the moment you click it is one
 * you stop trusting, and undo is a poor apology.
 *
 * Deliberately a modal rather than an inline overlay: the result can be several lines, it needs
 * to be read before it is accepted, and the house already has this dialog shape (item-detail,
 * workspace-settings). An inline box would be prettier and much easier to get wrong.
 */
import { useCallback, useEffect, useState } from "react";

import { compose, type AiTask } from "../../lib/ai/compose";
import { Spinner } from "../ui/spinner";

interface AiPanelProps {
  /** The text the task runs on — a selection, or the whole page as markdown. */
  source: string;
  tasks: AiTask[];
  /** Skip the menu and run this task straight away (the page-level Summarize button). */
  initialTask?: string;
  /** What "Keep" means: replace the selection, or insert a summary at the top. */
  onApply: (text: string) => void;
  onClose: () => void;
}

type Phase =
  | { kind: "choose" }
  | { kind: "running"; task: AiTask }
  | { kind: "done"; task: AiTask; text: string; truncated: boolean }
  | { kind: "error"; task: AiTask; message: string };

export function AiPanel({ source, tasks, initialTask, onApply, onClose }: AiPanelProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "choose" });

  const run = useCallback(
    async (task: AiTask) => {
      setPhase({ kind: "running", task });
      try {
        const result = await compose(task.key, source);
        setPhase({ kind: "done", task, text: result.text, truncated: result.truncated });
      } catch (error) {
        setPhase({
          kind: "error",
          task,
          message: error instanceof Error ? error.message : "Something went wrong",
        });
      }
    },
    [source],
  );

  // The page-level entry point has already chosen; don't make the user pick from a menu of one.
  useEffect(() => {
    if (!initialTask) return;
    const task = tasks.find((candidate) => candidate.key === initialTask);
    if (task) void run(task);
    // Only on mount: re-running because `run` changed identity would re-bill the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ask AI"
      data-testid="ai-panel"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-elevated shadow-xl"
      >
        <header className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-xs text-subtle">
            {phase.kind === "choose" ? "Ask AI" : phase.task.label}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Ask AI"
            className="-mr-1 rounded-md px-2 py-0.5 text-base leading-none text-subtle hover:bg-hover hover:text-fg"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {phase.kind === "choose" ? (
            <ul className="flex flex-col">
              {tasks.map((task) => (
                <li key={task.key}>
                  <button
                    type="button"
                    data-testid={`ai-task-${task.key}`}
                    onClick={() => void run(task)}
                    className="w-full rounded-lg px-2 py-2 text-left text-sm text-fg hover:bg-hover"
                  >
                    {task.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {phase.kind === "running" ? <Spinner label="Thinking…" /> : null}

          {phase.kind === "done" ? (
            <>
              {phase.truncated ? (
                // Say so rather than quietly summarizing the first half of a long page.
                <p className="mb-2 text-xs text-warn">
                  This page is very long, so only the beginning was read.
                </p>
              ) : null}
              <p
                data-testid="ai-result"
                className="whitespace-pre-wrap break-words text-sm text-fg"
              >
                {phase.text}
              </p>
            </>
          ) : null}

          {phase.kind === "error" ? (
            <p role="alert" className="text-sm text-danger">
              {phase.message}
            </p>
          ) : null}
        </div>

        {phase.kind === "done" || phase.kind === "error" ? (
          <footer className="flex items-center gap-2 border-t border-line px-5 py-3">
            {phase.kind === "done" ? (
              <button
                type="button"
                data-testid="ai-keep"
                onClick={() => {
                  // The document may have moved on while the panel was open — a block the
                  // result was meant for can be gone. Report that instead of throwing out of
                  // the handler, which would leave the dialog stuck with no explanation.
                  try {
                    onApply(phase.text);
                  } catch (error) {
                    setPhase({
                      kind: "error",
                      task: phase.task,
                      message:
                        error instanceof Error
                          ? `Couldn't apply that: ${error.message}`
                          : "Couldn't apply that.",
                    });
                    return;
                  }
                  onClose();
                }}
                className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-on-accent"
              >
                Keep
              </button>
            ) : null}
            <button
              type="button"
              data-testid="ai-retry"
              onClick={() => void run(phase.task)}
              className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:text-fg"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded px-2 py-1 text-xs text-subtle hover:text-fg"
            >
              Discard
            </button>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
