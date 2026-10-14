/**
 * One collapsible category of the Personalization dialog, and which ones are open.
 *
 * Which sections are open is remembered per device, like the sidebar's closed folders: a view
 * preference, not content. Appearance starts open, being what the dialog was first made for.
 */
import { useState, type ReactNode } from "react";

import { ChevronIcon } from "./tree-icons";

export type SectionId = "appearance" | "templates" | "ai";

const KEY = "tendto:personalization-open";
const DEFAULT_OPEN: readonly SectionId[] = ["appearance"];
const SECTION_IDS: readonly SectionId[] = ["appearance", "templates", "ai"];

function readOpen(): ReadonlySet<SectionId> {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : DEFAULT_OPEN;
    const ids = Array.isArray(parsed)
      ? parsed.filter((id): id is SectionId => SECTION_IDS.includes(id as SectionId))
      : DEFAULT_OPEN;
    return new Set(ids);
  } catch {
    return new Set(DEFAULT_OPEN); // storage blocked or the value is nonsense
  }
}

function writeOpen(ids: ReadonlySet<SectionId>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...ids]));
  } catch {
    // Storage unavailable: the sections still open and close, they just are not remembered.
  }
}

/** The open sections, and a toggle that remembers them. */
export function useOpenSections(): [ReadonlySet<SectionId>, (id: SectionId) => void] {
  const [open, setOpen] = useState<ReadonlySet<SectionId>>(readOpen);
  function toggle(id: SectionId): void {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeOpen(next);
      return next;
    });
  }
  return [open, toggle];
}

export function PrefSection({
  id,
  label,
  open,
  onToggle,
  children,
}: {
  id: SectionId;
  label: string;
  open: boolean;
  onToggle: (id: SectionId) => void;
  children: ReactNode;
}) {
  const bodyId = `pref-section-${id}`;
  return (
    <section className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={open}
        aria-controls={bodyId}
        data-testid={`pref-section-${id}`}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-fg hover:bg-hover/60"
      >
        {label}
        <ChevronIcon open={open} className="h-4 w-4 shrink-0 text-subtle" />
      </button>
      {open ? (
        <div id={bodyId} className="space-y-5 px-4 pb-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}
