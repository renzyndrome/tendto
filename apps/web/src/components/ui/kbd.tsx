/** A keyboard-hint chip (⌘K, ↵, esc). Monospace on a faint chip fill — Meadow spec. */
import type { ReactNode } from "react";

export function Kbd({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`kbd ${className}`}>{children}</span>;
}
