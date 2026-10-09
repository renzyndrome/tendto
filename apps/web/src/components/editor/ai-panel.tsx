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
 *
 * On a wide window the modal is a sheet on the right rather than a card over the middle: the
 * page column sits by the sidebar, so the right side is free, and a summary is easier to judge
 * with the page it summarizes still in view. The result renders as formatted text (the same
 * Markdown "Keep" inserts), not as asterisks and dashes.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { streamCompose, type AiTask } from "../../lib/ai/compose";
import { Spinner } from "../ui/spinner";
import { MarkdownPreview } from "./markdown-preview";

/** How long "Copied" stays on the Copy button. */
const COPIED_MS = 1500;

interface AiPanelProps {
  /** The text the task runs on — a selection, or the whole page as markdown. */
  source: string;
  tasks: AiTask[];
  /** Skip the menu and run this task straight away (the page-level Summarize button). */
  initialTask?: string;
  /** What "Keep" means: replace the selection, or insert a summary at the top. */
  onApply: (text: string) => void;
  /** Where "Keep" puts the result, shown beside it so nobody has to find out by pressing it. */
  applyHint: string;
  onClose: () => void;
}

type Phase =
  | { kind: "choose" }
  // `text` fills in as the engine writes. Watching it arrive is most of what makes this feel
  // usable — ten silent seconds reads as broken even when it is working perfectly.
  | { kind: "running"; task: AiTask; text: string }
  | { kind: "done"; task: AiTask; text: string; truncated: boolean }
  | { kind: "error"; task: AiTask; message: string };

export function AiPanel({
  source,
  tasks,
  initialTask,
  onApply,
  applyHint,
  onClose,
}: AiPanelProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "choose" });
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  /** Copy the result as written (Markdown), for pasting somewhere other than this page. */
  async function copyResult(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("copied");
    } catch {
      setCopied("failed"); // no clipboard permission, or not a secure context
    }
    setTimeout(() => setCopied("idle"), COPIED_MS);
  }

  // Abort the engine when the panel closes mid-answer. On the CLI engine an abandoned stream
  // is an abandoned subprocess, so this is not merely tidiness.
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => () => inFlight.current?.abort(), []);

  const run = useCallback(
    async (task: AiTask) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setPhase({ kind: "running", task, text: "" });
      try {
        const result = await streamCompose(
          task.key,
          source,
          (piece) =>
            setPhase((current) =>
              // Ignore deltas from a run that has been superseded ("Try again" while the
              // previous answer is still arriving).
              current.kind === "running" && current.task.key === task.key
                ? { ...current, text: current.text + piece }
                : current,
            ),
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setPhase({ kind: "done", task, text: result.text, truncated: result.truncated });
      } catch (error) {
        if (controller.signal.aborted) return;
        setPhase({
          kind: "error",
          task,
          message: error instanceof Error ? error.message : "Request failed. Try again.",
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh] lg:items-stretch lg:justify-end lg:bg-black/20 lg:p-0"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-elevated shadow-xl lg:h-full lg:max-h-none lg:w-[30rem] lg:max-w-[40vw] lg:rounded-none lg:border-y-0 lg:border-r-0"
      >
        <header className="flex items-center justify-between px-5 pb-3 pt-4 lg:border-b lg:border-line">
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

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 lg:pt-4">
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

          {phase.kind === "running" ? (
            phase.text ? (
              <div>
                <MarkdownPreview text={phase.text} testId="ai-streaming" />
                <span
                  aria-hidden
                  className="mt-1 inline-block h-4 w-1.5 animate-pulse bg-accent align-text-bottom"
                />
              </div>
            ) : (
              <Spinner label="Writing…" />
            )
          ) : null}

          {phase.kind === "done" ? (
            <>
              {phase.truncated ? (
                // Say so rather than quietly summarizing the first half of a long page.
                <p className="mb-3 text-xs text-warn">Long page. Only the beginning was read.</p>
              ) : null}
              <MarkdownPreview text={phase.text} testId="ai-result" />
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
                        error instanceof Error ? `Not applied: ${error.message}` : "Not applied.",
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
            {phase.kind === "done" ? (
              <button
                type="button"
                data-testid="ai-copy"
                onClick={() => void copyResult(phase.text)}
                className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:text-fg"
              >
                {copied === "copied" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded px-2 py-1 text-xs text-subtle hover:text-fg"
            >
              Discard
            </button>
            {phase.kind === "done" ? (
              <span className="ml-auto truncate text-xs text-subtle">{applyHint}</span>
            ) : null}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
