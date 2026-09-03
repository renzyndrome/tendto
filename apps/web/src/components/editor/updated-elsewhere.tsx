/**
 * "Updated elsewhere" — the one thing an open editor says about a change it did not make.
 *
 * Deliberately a line of text and a button, not a dialog: it must not steal the caret from
 * someone mid-sentence, and it must not imply the edit is lost (it is not — reloading shows
 * it). No diff, no merge UI, no per-block markers. See `useExternalEdit`.
 */
interface UpdatedElsewhereProps {
  onReload: () => void;
  /** "page" sits above a document body; "compact" fits the card description box. */
  variant?: "page" | "compact";
}

export function UpdatedElsewhere({ onReload, variant = "page" }: UpdatedElsewhereProps) {
  return (
    <div
      role="status"
      data-testid="updated-elsewhere"
      className={`flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 text-subtle ${
        variant === "compact" ? "mb-2 py-1.5 text-[11px]" : "mb-3 py-2 text-xs"
      }`}
    >
      <span>Updated on another device.</span>
      <button
        type="button"
        onClick={onReload}
        className="shrink-0 rounded-md px-2 py-0.5 font-medium text-fg underline-offset-2 transition-colors hover:bg-hover hover:underline"
      >
        Reload
      </button>
    </div>
  );
}
