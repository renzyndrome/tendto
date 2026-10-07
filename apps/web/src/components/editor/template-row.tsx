/**
 * The template picker: one quiet row above a blank page body, gone once the page holds anything.
 *
 * Subscribed to BlockEditor's content signal exactly as SummarizeRow is, and for the same
 * reason: the page turning non-empty re-renders this row and nothing else, so the editor (and
 * any toolbar it has open) is never re-rendered by the row appearing or vanishing.
 */
import { useSyncExternalStore } from "react";

import { PAGE_TEMPLATES, type PageTemplate } from "../../lib/templates";

export function TemplateRow({
  subscribe,
  read,
  onPick,
}: {
  subscribe: (listener: () => void) => () => void;
  read: () => boolean;
  onPick: (template: PageTemplate) => void;
}) {
  const hasContent = useSyncExternalStore(subscribe, read, read);
  if (hasContent) return null;
  return (
    // Same height as SummarizeRow, which takes this slot once there is content (when an AI
    // engine is present), so the body does not jump when one replaces the other.
    <div
      role="group"
      aria-label="Templates"
      data-testid="page-templates"
      className="mb-1 flex flex-wrap items-center gap-x-1 text-xs"
    >
      <span className="pr-1 text-subtle">Templates</span>
      {PAGE_TEMPLATES.map((template) => (
        <button
          key={template.id}
          type="button"
          onClick={() => onPick(template)}
          className="rounded px-2 py-1 text-muted hover:bg-hover hover:text-fg"
        >
          {template.label}
        </button>
      ))}
    </div>
  );
}
