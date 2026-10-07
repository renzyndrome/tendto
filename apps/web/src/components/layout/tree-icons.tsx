/**
 * Small line icons for the page tree, drawn in `currentColor` so they follow the text tokens in
 * both themes. Hand-rolled like the rest of the UI: the app ships no icon library.
 */
import type { ReactNode } from "react";

interface IconProps {
  className?: string;
}

function Svg({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className ?? "h-4 w-4"}
    >
      {children}
    </svg>
  );
}

export function ChevronIcon({ open, className }: IconProps & { open: boolean }) {
  return (
    <Svg className={className}>
      <path d={open ? "M4.5 6.5 8 10l3.5-3.5" : "M6.5 4.5 10 8l-3.5 3.5"} strokeWidth={1.5} />
    </Svg>
  );
}

export function FolderIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M2 4.5c0-.6.4-1 1-1h3l1.5 1.5H13c.6 0 1 .4 1 1V12c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z" />
    </Svg>
  );
}

export function NewPageIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M9 2H4.5c-.6 0-1 .4-1 1v10c0 .6.4 1 1 1H8" />
      <path d="M9 2l3.5 3.5V8" />
      <path d="M9 2v3.5h3.5" />
      <path d="M12 10.5v4M10 12.5h4" />
    </Svg>
  );
}

export function NewFolderIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 13H3c-.6 0-1-.4-1-1V4.5c0-.6.4-1 1-1h3l1.5 1.5H13c.6 0 1 .4 1 1V8" />
      <path d="M12 10.5v4M10 12.5h4" />
    </Svg>
  );
}

/** A small board (three columns) with a plus: "new collection". */
export function NewCollectionIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 13H3c-.6 0-1-.4-1-1V4c0-.6.4-1 1-1h10c.6 0 1 .4 1 1v4" />
      <path d="M6 3v10M10 3v5" />
      <path d="M12 10.5v4M10 12.5h4" />
    </Svg>
  );
}

/** A five-point star, outlined, or filled for a favorite. */
export function StarIcon({ filled, className }: IconProps & { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinejoin="round"
      aria-hidden
      className={className ?? "h-4 w-4"}
    >
      <path d="M8 2.2l1.75 3.55 3.9.57-2.82 2.75.66 3.89L8 11.13l-3.49 1.83.66-3.89L2.35 6.32l3.9-.57z" />
    </svg>
  );
}
