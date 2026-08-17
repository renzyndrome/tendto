/**
 * Controlled text field that commits on blur or Enter (not on every keystroke).
 *
 * `multiline` swaps the <input> for an auto-growing <textarea>. That is a PRESENTATION choice,
 * not a data one: the value is still a single line of text, so Enter still commits rather than
 * inserting a newline and pasted newlines collapse to spaces. It exists because a board card is
 * narrow — in an <input>, a long title scrolls horizontally and shows only the fragment around
 * the caret, so the card reads as truncated nonsense.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface InlineTextProps {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** Wrap onto as many lines as the text needs instead of scrolling sideways. */
  multiline?: boolean;
  ariaLabel?: string;
}

export function InlineText({
  value,
  onCommit,
  placeholder,
  className,
  multiline = false,
  ariaLabel,
}: InlineTextProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow to fit. Layout effect so the height is right before paint — otherwise every edit
  // flashes at the old height.
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [draft, multiline]);

  const commit = () => {
    if (draft !== value) onCommit(draft);
  };

  if (!multiline) {
    return (
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={className}
      />
    );
  }

  return (
    <textarea
      ref={textareaRef}
      rows={1}
      value={draft}
      // Collapse any newlines (from a paste) — this is a one-line value shown over many lines.
      onChange={(event) => setDraft(event.target.value.replace(/\s*\n+\s*/g, " "))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault(); // never insert a newline
          event.currentTarget.blur();
        }
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={`resize-none overflow-hidden ${className ?? ""}`}
    />
  );
}
