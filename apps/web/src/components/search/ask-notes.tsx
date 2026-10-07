/**
 * "Ask my notes" — one question, one answer, with the notes it came from.
 *
 * Retrieval runs on the device (see lib/ai/retrieve.ts) and only the extracts it picks are sent,
 * so the panel says how many pages left the device rather than leaving that to be guessed. There
 * is no chat history: a question and its answer, then it resets. A thread would turn a search box
 * into a second place to keep things, which is the clutter this product exists to avoid.
 *
 * Nothing reaches a document unless "Insert into this page" is pressed — the same rule the
 * rewrite panel follows.
 */
import { useEffect, useRef, useState } from "react";

import { engineLabel, streamCompose } from "../../lib/ai/compose";
import { retrieveSources, type Source } from "../../lib/ai/retrieve";
import { useUiStore } from "../../stores/ui";

type Phase = "retrieving" | "streaming" | "done" | "empty" | "error";

interface AskNotesProps {
  workspaceId: string | null;
  question: string;
  engine: string;
  /** Called when a source row is chosen, so the palette can close before navigating. */
  onOpenPage: (pageId: string) => void;
}

export function AskNotes({ workspaceId, question, engine, onOpenPage }: AskNotesProps) {
  const [phase, setPhase] = useState<Phase>("retrieving");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState("");
  const [inserted, setInserted] = useState(false);
  const pageInsert = useUiStore((s) => s.pageInsert);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    abort.current = controller;
    let live = true;

    void (async () => {
      try {
        const retrieval = await retrieveSources(workspaceId, question);
        if (!live) return;
        // No sources means no request. Asking a model to answer from an empty bundle spends a
        // call to be told what the device already knew.
        if (retrieval.sources.length === 0) {
          setPhase("empty");
          return;
        }
        setSources(retrieval.sources);
        setPhase("streaming");
        await streamCompose(
          "ask",
          retrieval.text,
          (piece) => live && setAnswer((current) => current + piece),
          controller.signal,
          { question },
        );
        if (live) setPhase("done");
      } catch (err) {
        if (!live || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "The AI engine could not answer.");
        setPhase("error");
      }
    })();

    return () => {
      live = false;
      controller.abort();
    };
  }, [workspaceId, question]);

  if (phase === "empty") {
    return (
      <p className="px-4 py-6 text-center text-sm text-subtle" data-testid="ask-empty">
        Nothing in your notes matches that.
      </p>
    );
  }

  if (phase === "error") {
    return (
      <p className="px-4 py-6 text-center text-sm text-danger" data-testid="ask-error">
        {error}
      </p>
    );
  }

  const canInsert = phase === "done" && pageInsert !== null && answer.trim().length > 0;

  return (
    <div className="px-4 py-3">
      <p className="mb-2 text-xs text-subtle">
        {phase === "retrieving"
          ? "Looking through your notes…"
          : `Answered from ${sources.length} ${sources.length === 1 ? "page" : "pages"} by ${engineLabel(engine)}.`}
      </p>

      <p
        data-testid="ask-answer"
        className="whitespace-pre-wrap text-sm text-fg"
        aria-live="polite"
      >
        {answer}
        {phase === "streaming" ? <span className="text-subtle"> ▍</span> : null}
      </p>

      {sources.length > 0 ? (
        <div className="mt-3 border-t border-line pt-2">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-subtle">
            Sources ({sources.length})
          </p>
          <ul>
            {sources.map((source) => (
              <li key={source.pageId}>
                <button
                  type="button"
                  data-testid="ask-source"
                  onClick={() => onOpenPage(source.pageId)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-muted hover:bg-hover"
                >
                  <span className="shrink-0 text-xs text-subtle">[{source.number}]</span>
                  <span className="truncate">{source.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {phase === "done" ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            data-testid="ask-copy"
            onClick={() => void navigator.clipboard?.writeText(answer)}
            className="rounded border border-line px-2 py-1 text-xs text-muted hover:bg-hover"
          >
            Copy
          </button>
          {canInsert ? (
            <button
              type="button"
              data-testid="ask-insert"
              disabled={inserted}
              onClick={() => {
                pageInsert?.insert(answer, sources);
                setInserted(true);
              }}
              className="rounded border border-line px-2 py-1 text-xs text-muted hover:bg-hover disabled:opacity-50"
            >
              {inserted ? "Inserted" : "Insert into this page"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
