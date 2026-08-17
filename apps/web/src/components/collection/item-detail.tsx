/**
 * Item detail — the dialog you get by clicking a card.
 *
 * Deliberately NOT a Trello card. It carries the title, a rich description (the field items
 * previously had nowhere to put), and the fields that already existed but were cramped into an
 * 18rem card: status, due date + optional time, assignee. No labels, no per-card checklists, no
 * attachments, no activity feed — see docs/planning/03-roadmap.md §guardrails, and note that a
 * checklist inside a card would fork the "same data, many views" primitive that collections are
 * built on (sub-tasks belong in the collection, where every view can see them).
 *
 * The description reuses the page editor's BlockEditor, so a card body is the same primitive as
 * a page body — same blocks, same paste handling, same inline images.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { itemOwner, loadBlocks, type BlockRow } from "../../lib/blocks/serialize";
import { clearDraft, draftKey, readDraft, writeDraft } from "../../lib/drafts";
import { deleteItem, parseProperties, patchItem, type Column, type ItemRow } from "../../lib/items/mutations";
import { Spinner } from "../ui/spinner";
import { BlockEditor, type SaveState } from "../editor/block-editor";
import { AssigneePicker } from "./views/assignee-picker";
import { DuePicker } from "./views/due-picker";

interface ItemDetailProps {
  row: ItemRow;
  columns: Column[];
  workspaceId: string | null;
  onClose: () => void;
  /** Called after the item is deleted, so the caller can drop the route/selection. */
  onDeleted: () => void;
}

const TITLE_DEBOUNCE_MS = 400;

/** Same crash-safe stash as the description body — see lib/drafts.ts. */
const titleDraftKey = (itemId: string) => draftKey("item-title", itemId);

export function ItemDetail({ row, columns, workspaceId, onClose, onDeleted }: ItemDetailProps) {
  const rowId = row.id;
  const props = parseProperties(row);
  const [blocks, setBlocks] = useState<BlockRow[] | null>(null);
  // A stashed title only exists if the last session was torn down before the write landed.
  const [title, setTitle] = useState(() => readDraft<string>(titleDraftKey(rowId)) ?? props.title);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  /*
   * The title used to commit on blur ALONE, which meant reloading or closing the tab while it
   * still had focus threw the edit away. It now also commits on a short debounce, on unmount,
   * and when the page is hidden — the same guarantees the description body has.
   */
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestTitle = useRef(title);
  latestTitle.current = title;
  const committedTitle = useRef(props.title);
  /** A title write that has been issued but not yet settled — see block-editor.tsx. */
  const titleInFlight = useRef(false);

  // `row` is a fresh object on every render (it comes from a reactive query), so depending on
  // it directly gave commitTitle a new identity each render — which re-subscribed the
  // page-hidden effect and ran its cleanup (a commit) on every render. Depend on the id and
  // read the row through a ref.
  const rowRef = useRef(row);
  rowRef.current = row;

  const commitTitle = useCallback(() => {
    if (titleTimer.current) {
      clearTimeout(titleTimer.current);
      titleTimer.current = null;
    }
    const next = latestTitle.current;
    if (next === committedTitle.current) return;
    committedTitle.current = next;
    titleInFlight.current = true;
    setSaveState("saving");
    void patchItem(rowRef.current, { title: next }).then(
      () => {
        titleInFlight.current = false;
        clearDraft(titleDraftKey(rowId));
        setSaveState("saved");
      },
      () => {
        titleInFlight.current = false;
        committedTitle.current = ""; // force a retry on the next commit
      },
    );
  }, [rowId]);

  useEffect(() => {
    const onHide = () => {
      // localStorage is synchronous, so it survives a teardown that the async write cannot.
      if (latestTitle.current !== committedTitle.current || titleInFlight.current) {
        writeDraft(titleDraftKey(rowId), latestTitle.current);
      }
      commitTitle();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      commitTitle(); // unmount (closing the dialog) must not lose a pending title
    };
  }, [commitTitle, rowId]);

  // Replay anything recovered from a previous session into the replica straight away.
  useEffect(() => {
    const draft = readDraft<string>(titleDraftKey(rowId));
    if (draft === null) return;
    // The previous session's write may well have landed before the page died, in which case
    // commitTitle would early-return and leave the draft behind forever. Drop it explicitly.
    if (draft === committedTitle.current) clearDraft(titleDraftKey(rowId));
    else commitTitle();
    // Only on first mount for this item.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowId]);

  // One-shot read, like the page editor — a reactive query would fight BlockNote's state.
  useEffect(() => {
    let cancelled = false;
    void loadBlocks(itemOwner(row.id)).then((loaded) => {
      if (!cancelled) setBlocks(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Escape belongs to the innermost thing that's open. The editor's slash/emoji menu and
      // link toolbar render in a portal outside this dialog, so without this check dismissing
      // the slash menu would close the whole card and lose the user's place mid-edit.
      if (document.querySelector(".bn-suggestion-menu, .bn-link-toolbar")) return;
      onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const known = columns.some((column) => column.id === props.status);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Card details"
      data-testid="item-detail"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[6vh]"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-elevated shadow-xl"
      >
        <header className="flex items-start gap-3 px-5 pb-3 pt-5">
          <textarea
            rows={1}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value.replace(/\s*\n+\s*/g, " "));
              if (titleTimer.current) clearTimeout(titleTimer.current);
              titleTimer.current = setTimeout(commitTitle, TITLE_DEBOUNCE_MS);
            }}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            placeholder="Untitled"
            aria-label="Card title"
            data-testid="detail-title"
            className="min-w-0 flex-1 resize-none overflow-hidden bg-transparent text-lg font-semibold leading-snug text-fg outline-none placeholder:text-subtle"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close card"
            className="-mr-1 shrink-0 rounded-md px-2 py-0.5 text-base leading-none text-subtle hover:bg-hover hover:text-fg"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-[4.5rem_1fr] items-center gap-x-3 gap-y-2 px-5 pb-4 text-xs text-subtle">
            <span>Status</span>
            <select
              value={props.status}
              onChange={(event) => void patchItem(row, { status: event.target.value })}
              aria-label="Card status"
              className="w-full rounded-lg border border-line bg-app px-2.5 py-1.5 text-sm text-muted outline-none transition-shadow focus:border-muted/60"
            >
              {/* Keep an orphaned status visible until the user re-picks a column. */}
              {known ? null : <option value={props.status}>{props.status}</option>}
              {columns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.label}
                </option>
              ))}
            </select>

            <span>Due</span>
            <DuePicker
              value={typeof props.due === "string" ? props.due : ""}
              onChange={(due) => void patchItem(row, { due })}
              compact
              idPrefix="detail-due"
            />

            <span>Assignee</span>
            <AssigneePicker
              workspaceId={workspaceId}
              value={typeof props.assignee === "string" ? props.assignee : ""}
              onChange={(assignee) => void patchItem(row, { assignee })}
              ariaLabel="Card assignee"
              className="w-full rounded-lg border border-line bg-app px-2.5 py-1.5 text-sm text-muted outline-none transition-shadow focus:border-muted/60"
            />
          </div>

          <div className="px-5 pb-4">
            {/* Same voice as the row labels above (sentence case, 12px, subtle) — an uppercase
                section header alongside "Status"/"Due" was two label languages in one dialog. */}
            <div className="mb-1.5 flex items-baseline justify-between">
              <h3 className="text-xs text-subtle">Description</h3>
              {/* Autosave is silent by design, but silence reads as "did that save?" — so say
                  so, quietly. */}
              <span
                data-testid="save-state"
                aria-live="polite"
                className="text-[11px] text-subtle transition-opacity"
                style={{ opacity: saveState === "idle" ? 0 : 1 }}
              >
                {saveState === "saving" ? "Saving…" : "Saved"}
              </span>
            </div>
            {blocks === null ? (
              <Spinner label="Loading…" />
            ) : (
              // key: a fresh editor per item, so opening another card never shows stale content.
              <div data-testid="detail-description">
                <BlockEditor
                  key={row.id}
                  owner={itemOwner(row.id)}
                  workspaceId={workspaceId}
                  initialBlocks={blocks}
                  variant="compact"
                  onSaveStateChange={setSaveState}
                />
              </div>
            )}
          </div>
        </div>

        <footer className="flex items-center justify-end px-5 pb-4">
          <button
            type="button"
            onClick={() => {
              if (!window.confirm(`Delete "${props.title || "Untitled"}"?`)) return;
              void deleteItem(row.id).then(onDeleted);
            }}
            className="rounded px-2 py-1 text-xs text-subtle hover:text-danger"
          >
            Delete card
          </button>
        </footer>
      </div>
    </div>
  );
}
