/**
 * The template picker: one quiet row above a blank page body, gone once the page holds anything.
 *
 * Subscribed to BlockEditor's content signal exactly as SummarizeRow is, and for the same
 * reason: the page turning non-empty re-renders this row and nothing else, so the editor (and
 * any toolbar it has open) is never re-rendered by the row appearing or vanishing. The custom
 * templates query lives here for the same reason.
 *
 * A user's own templates come first, then the built-in ones, as edited or deleted in
 * Personalization. A stored template's body is read only when it is picked, so a template
 * holding images does not weigh on every blank page.
 */
import type { PartialBlock } from "@blocknote/core";
import { useSyncExternalStore } from "react";

import { loadTemplate, useTemplateList, type TemplateEntry } from "../../lib/templates";
import { useHiddenIds } from "../../stores/pending-delete";

export function TemplateRow({
  subscribe,
  read,
  onPick,
}: {
  subscribe: (listener: () => void) => () => void;
  read: () => boolean;
  onPick: (blocks: readonly PartialBlock[]) => void;
}) {
  const hasContent = useSyncExternalStore(subscribe, read, read);
  const hidden = useHiddenIds();
  // A template deleted in Personalization leaves at once, before its Undo window closes.
  const entries = useTemplateList().entries.filter((entry) => !hidden.has(entry.key));
  if (hasContent || entries.length === 0) return null;

  function pick(entry: TemplateEntry): void {
    if (entry.kind === "builtin") {
      onPick(entry.template.blocks);
      return;
    }
    void loadTemplate(entry.id)
      .then((template) => {
        if (template) onPick(template.blocks);
      })
      // A failed read leaves the page blank and the row in place, so the pick can be retried.
      .catch(() => undefined);
  }

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
      {entries.map((entry) => (
        <TemplateButton key={entry.key} onClick={() => pick(entry)}>
          {entry.label}
        </TemplateButton>
      ))}
    </div>
  );
}

function TemplateButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded px-2 py-1 text-muted hover:bg-hover hover:text-fg"
    >
      {children}
    </button>
  );
}
