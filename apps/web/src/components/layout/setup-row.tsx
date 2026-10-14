/**
 * A setup row under Personalization > AI: closed until clicked, so nothing asks for a key or a
 * command before someone has chosen to set one up. The summary line shows either way.
 */
import { useState, type ReactNode } from "react";

import { ChevronIcon } from "./tree-icons";

export function SetupRow({
  label,
  summary,
  testid,
  children,
}: {
  label: string;
  /** One line shown open or closed: what is set up now. */
  summary?: string | null;
  testid: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid={testid} className="space-y-1">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        data-testid={`${testid}-toggle`}
        className="flex w-full items-center justify-between rounded px-1 py-1 text-left text-sm text-fg hover:bg-hover/60"
      >
        {label}
        <ChevronIcon open={open} className="h-3.5 w-3.5 shrink-0 text-subtle" />
      </button>
      {summary ? (
        <p data-testid={`${testid}-summary`} className="px-1 text-xs text-subtle">
          {summary}
        </p>
      ) : null}
      {open ? <div className="space-y-2 px-1 pt-1">{children}</div> : null}
    </div>
  );
}
