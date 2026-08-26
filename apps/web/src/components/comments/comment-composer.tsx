/**
 * The comment box: a plain textarea with an @mention picker.
 *
 * Deliberately not BlockNote. A comment is a sentence, not a document — the rich editor would
 * bring a slash menu, block handles and drag targets to a two-line reply, which is exactly the
 * clutter the product exists to avoid. Mentions are the one piece of structure, and they live
 * as inline tokens in the text (see lib/comments/mentions.ts).
 *
 * The picker is hand-rolled, matching the house style (there is no component library here).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  filterRoster,
  loadMentionRoster,
  type MentionCandidate,
} from "../../lib/comments/mention-roster";
import { activeMentionQuery, insertMention } from "../../lib/comments/mentions";

interface CommentComposerProps {
  workspaceId: string;
  /** Prefilled text when editing an existing comment. */
  initialValue?: string;
  submitLabel: string;
  placeholder?: string;
  autoFocus?: boolean;
  onSubmit: (body: string) => void | Promise<void>;
  onCancel?: () => void;
}

export function CommentComposer({
  workspaceId,
  initialValue = "",
  submitLabel,
  placeholder = "Write a comment…",
  autoFocus = false,
  onSubmit,
  onCancel,
}: CommentComposerProps) {
  const [value, setValue] = useState(initialValue);
  const [roster, setRoster] = useState<MentionCandidate[]>([]);
  const [query, setQuery] = useState<{ query: string; start: number } | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Where the caret must land once React has written the post-insert value. Applied in a LAYOUT
  // effect, not a rAF: deferring it by a frame lets the next keystrokes land at the stale
  // position, so someone who keeps typing straight after picking a name gets scrambled text.
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    const node = textareaRef.current;
    if (caret === null || !node) return;
    pendingCaret.current = null;
    node.focus();
    node.setSelectionRange(caret, caret);
  });

  // Fetched once per workspace and cached in the module; offline it resolves to [], which
  // simply means the picker never opens and `@someone` stays plain text.
  useEffect(() => {
    let cancelled = false;
    void loadMentionRoster(workspaceId).then((members) => {
      if (!cancelled) setRoster(members);
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const matches = useMemo(
    () => (query === null ? [] : filterRoster(roster, query.query)),
    [query, roster],
  );
  const open = matches.length > 0;

  function syncQuery(target: HTMLTextAreaElement) {
    const next = activeMentionQuery(target.value, target.selectionStart ?? 0);
    setQuery(next);
    setHighlighted(0);
  }

  function choose(candidate: MentionCandidate | undefined) {
    // `highlighted` can outlive the list it indexed: the roster resolves asynchronously, so a
    // keystroke can shrink `matches` between render and keydown.
    if (query === null || candidate === undefined) return;
    const next = insertMention(value, query, candidate.userId, candidate.label);
    pendingCaret.current = next.caret;
    setValue(next.text);
    setQuery(null);
  }

  async function submit() {
    const body = value.trim();
    // The in-flight guard is not cosmetic: the write is async and the text stays in the box
    // until it resolves, so two quick Enters would post the same comment twice.
    if (body.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(body);
      // A fresh composer empties itself for the next comment; an edit composer is about to
      // unmount, so leaving its text alone avoids a flash of the pre-edit value.
      if (initialValue === "") setValue("");
      setQuery(null);
    } catch {
      // Keep the text — a failed write must never eat what someone just wrote.
      setError("Couldn't save that. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative" data-testid="comment-composer">
      <textarea
        ref={textareaRef}
        rows={2}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={submitLabel}
        onChange={(event) => {
          setValue(event.target.value);
          syncQuery(event.target);
        }}
        onClick={(event) => syncQuery(event.currentTarget)}
        onBlur={() => setQuery(null)}
        onKeyDown={(event) => {
          if (open) {
            // While the picker is up it owns these keys — and the card dialog is listening for
            // Escape on the document, so stop it before it closes the whole card.
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setHighlighted((current) => (current + step + matches.length) % matches.length);
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              choose(matches[highlighted]);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setQuery(null);
              return;
            }
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit();
            return;
          }
          if (event.key === "Escape" && onCancel) {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        className="w-full resize-y rounded-lg border border-line bg-app px-2.5 py-1.5 text-sm text-fg outline-none transition-shadow placeholder:text-subtle focus:border-muted/60"
      />

      {open ? (
        // data-mention-menu is what the card dialog's Escape handler looks for, so dismissing
        // the picker never closes the card underneath it.
        <ul
          data-mention-menu
          data-testid="mention-menu"
          role="listbox"
          className="absolute left-0 top-full z-10 mt-1 w-64 overflow-hidden rounded-lg border border-line bg-elevated py-1 shadow-xl"
        >
          {matches.map((candidate, index) => (
            <li key={candidate.userId}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlighted}
                // mousedown, not click: the textarea's blur would clear the query first.
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(candidate);
                }}
                onMouseEnter={() => setHighlighted(index)}
                className={`block w-full truncate px-3 py-1.5 text-left text-sm ${
                  index === highlighted ? "bg-hover text-fg" : "text-muted"
                }`}
              >
                {candidate.label}
                {candidate.isYou ? <span className="text-subtle"> (you)</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={value.trim().length === 0 || submitting}
          className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-on-accent disabled:opacity-40"
        >
          {submitLabel}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-2 py-1 text-xs text-subtle hover:text-fg"
          >
            Cancel
          </button>
        ) : null}
        {error ? (
          <span role="alert" className="text-xs text-danger">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
