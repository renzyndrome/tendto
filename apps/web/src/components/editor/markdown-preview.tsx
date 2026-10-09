/**
 * A read-only preview of the small Markdown subset AI results use: headings, bullet, numbered
 * and check lists, quotes, and **bold** / *italic* / `code` inside a line. It shows the result
 * the way "Keep" will put it into the page (BlockNote parses the same Markdown), instead of
 * asterisks and dashes.
 *
 * Built from React elements, never from an HTML string: the text comes from a model, and a
 * preview must not be a way to put markup, scripts or live links into the app. A link shows its
 * text only. Anything outside the subset is shown as written, which is also how a half-streamed
 * answer reads while a `**` is still waiting for its closing pair.
 */
import type { ReactNode } from "react";

type Line =
  | { kind: "heading"; level: number; text: string }
  | { kind: "bullet"; depth: number; text: string }
  | { kind: "number"; depth: number; text: string }
  | { kind: "check"; depth: number; checked: boolean; text: string }
  | { kind: "quote"; text: string }
  | { kind: "text"; text: string }
  | { kind: "blank" };

function parseLine(raw: string): Line {
  if (raw.trim() === "") return { kind: "blank" };
  const depth = Math.floor((raw.length - raw.trimStart().length) / 2);
  const line = raw.trim();
  let match = /^(#{1,6})\s+(.*)$/.exec(line);
  if (match) return { kind: "heading", level: match[1].length, text: match[2] };
  match = /^[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
  if (match) return { kind: "check", depth, checked: match[1] !== " ", text: match[2] };
  match = /^[-*+]\s+(.*)$/.exec(line);
  if (match) return { kind: "bullet", depth, text: match[1] };
  match = /^\d+[.)]\s+(.*)$/.exec(line);
  if (match) return { kind: "number", depth, text: match[1] };
  match = /^>\s?(.*)$/.exec(line);
  if (match) return { kind: "quote", text: match[1] };
  return { kind: "text", text: line };
}

/** Bold, italic, code and link text inside one line. Unclosed markers stay literal. */
const INLINE =
  /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_|\[[^\]\n]+\]\([^)\n]*\))/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    if (!part) return null;
    if (/^(\*\*|__).+\1$/.test(part)) {
      return (
        <strong key={index} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (/^`.+`$/.test(part)) {
      return (
        <code key={index} className="rounded bg-hover px-1 font-mono text-[0.92em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (/^(\*|_).+\1$/.test(part)) return <em key={index}>{part.slice(1, -1)}</em>;
    const link = /^\[([^\]]+)\]\(/.exec(part);
    if (link) return <span key={index}>{link[1]}</span>;
    return <span key={index}>{part}</span>;
  });
}

const indent = (depth: number) => ({ marginLeft: `${depth * 1.25}rem` });

export function MarkdownPreview({ text, testId }: { text: string; testId?: string }) {
  const lines = text.split("\n").map(parseLine);
  let number = 0;

  return (
    <div data-testid={testId} className="space-y-1.5 break-words text-sm leading-relaxed text-fg">
      {lines.map((line, index) => {
        // Numbering survives blank lines and nested sub-items between its items (both are how
        // models write lists), and restarts after anything else.
        if (line.kind === "number") number += 1;
        else if (!(line.kind === "blank" || ("depth" in line && line.depth > 0))) number = 0;
        switch (line.kind) {
          case "blank":
            return null;
          case "heading":
            return (
              <p key={index} className="pt-1 font-semibold text-fg">
                {inline(line.text)}
              </p>
            );
          case "bullet":
            return (
              <p key={index} className="flex gap-2" style={indent(line.depth)}>
                <span aria-hidden className="select-none text-subtle">
                  •
                </span>
                <span className="min-w-0 flex-1">{inline(line.text)}</span>
              </p>
            );
          case "number":
            return (
              <p key={index} className="flex gap-2" style={indent(line.depth)}>
                <span aria-hidden className="select-none tabular-nums text-subtle">
                  {number}.
                </span>
                <span className="min-w-0 flex-1">{inline(line.text)}</span>
              </p>
            );
          case "check":
            return (
              <p key={index} className="flex gap-2" style={indent(line.depth)}>
                <span aria-hidden className="select-none text-subtle">
                  {line.checked ? "☑" : "☐"}
                </span>
                <span className={`min-w-0 flex-1 ${line.checked ? "text-muted line-through" : ""}`}>
                  {inline(line.text)}
                </span>
              </p>
            );
          case "quote":
            return (
              <p key={index} className="border-l-2 border-line pl-3 text-muted">
                {inline(line.text)}
              </p>
            );
          default:
            return <p key={index}>{inline(line.text)}</p>;
        }
      })}
    </div>
  );
}
