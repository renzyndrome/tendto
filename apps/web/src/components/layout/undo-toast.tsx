/**
 * The Undo bar for a sidebar delete (see stores/pending-delete.ts). Bottom-centre, above the
 * page, for the few seconds the delete can still be cancelled; renders nothing otherwise.
 */
import { usePendingDelete } from "../../stores/pending-delete";

export function UndoToast() {
  const pending = usePendingDelete((state) => state.pending);
  const undo = usePendingDelete((state) => state.undo);
  if (!pending) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="undo-toast"
      className="fixed bottom-4 left-1/2 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-4 rounded-lg border border-line bg-elevated px-4 py-2 text-sm text-fg shadow-lg"
    >
      <span className="truncate">{pending.label}</span>
      <button
        type="button"
        onClick={undo}
        className="shrink-0 rounded px-1.5 py-0.5 font-medium text-fg hover:bg-hover"
      >
        Undo
      </button>
    </div>
  );
}
