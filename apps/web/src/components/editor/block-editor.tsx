/**
 * BlockEditor — BlockNote wired to the local replica for ANY block owner (a page, or an item's
 * description). Extracted from PageEditor so a card body is literally the same editor as a page
 * body: same block set, same paste handling, same inline images, same persistence.
 *
 * The hydrate/persist loop deliberately does NOT fight BlockNote's own document state:
 *  - hydrate ONCE from a one-shot read, never a reactive query;
 *  - the caller keys this component by owner id so switching remounts it with fresh content;
 *  - persist on change, debounced, into the local replica. PowerSync uploads the queued CRUD.
 * There is NO network code here.
 */
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import type { Block, PartialBlock } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import {
  BasicTextStyleButton,
  BlockTypeSelect,
  CreateLinkButton,
  FormattingToolbar,
  useCreateBlockNote,
} from "@blocknote/react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import {
  persistBlocks,
  rowToBlock,
  type BlockOwner,
  type BlockRow,
} from "../../lib/blocks/serialize";
import { clearDraft, draftKey, onPageHidden, readDraft, writeDraft } from "../../lib/drafts";
import { useThemeStore } from "../../stores/theme";

const SAVE_DEBOUNCE_MS = 500;
// Inline images are stored as data URLs in the block content (offline-friendly, syncs as text).
// Capped so a huge paste can't bloat the replica; real object storage is a later upgrade.
const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;

/** BlockNote uploadFile handler: read a pasted/dropped/picked image into a data URL. */
async function uploadInlineFile(file: File): Promise<string> {
  if (file.size > MAX_INLINE_IMAGE_BYTES) {
    throw new Error("Image too large (max 5MB until file storage is added).");
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

/** What the surrounding UI can tell the user about unsaved work. */
export type SaveState = "idle" | "saving" | "saved";

interface BlockEditorProps {
  owner: BlockOwner;
  workspaceId: string | null;
  initialBlocks: BlockRow[];
  /** Report autosave progress so a caller can show it (see ItemDetail). */
  onSaveStateChange?: (state: SaveState) => void;
  /**
   * "page" is the full document surface (drag handles, the block gutter, everything).
   * "compact" is the Linear-style description box: the same editor and the same markdown
   * shortcuts, but without the block chrome — a card description is a paragraph or two, and a
   * drag-handle gutter next to it reads as machinery rather than a text field. Formatting is
   * still there via the selection toolbar and "/" .
   */
  variant?: "page" | "compact";
}

export function BlockEditor({
  owner,
  workspaceId,
  initialBlocks,
  onSaveStateChange,
  variant = "page",
}: BlockEditorProps) {
  // BlockNote/Mantine otherwise picks its own theme from `prefers-color-scheme`, which renders
  // a dark editor inside a light shell whenever the OS is dark. Drive it from OUR theme.
  const theme = useThemeStore((s) => s.resolved);

  // A draft only exists if the last session was torn down mid-edit, so it is by definition
  // newer than what reached the replica.
  const bodyKey = draftKey(owner.kind, owner.id);
  const recovered = useRef(readDraft<PartialBlock[]>(bodyKey));
  const initialContent = useMemo(
    () =>
      recovered.current ??
      (initialBlocks.length > 0 ? initialBlocks.map(rowToBlock) : undefined),
    [initialBlocks],
  );
  const editor = useCreateBlockNote({ initialContent, uploadFile: uploadInlineFile });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  /*
   * A write that has been issued but hasn't settled yet. `dirty` is cleared the moment a save
   * starts, so on its own it would report "nothing to stash" for an in-flight write — and if
   * the page is torn down before that write lands, the text is gone. Track the in-flight state
   * separately so the crash-safe draft covers it too.
   */
  const inFlight = useRef(false);

  // Callers build the owner inline (`itemOwner(row.id)`), so the prop is a NEW OBJECT on every
  // render. Depending on it directly made `flush` change identity every render, which re-ran
  // the unmount-flush effect every render and could overlap two saves of the same document —
  // the second INSERT then failed with "UNIQUE constraint failed: ps_data__blocks.id".
  // Depend on the primitives instead.
  const { kind: ownerKind, id: ownerId } = owner;
  const stableOwner = useMemo<BlockOwner>(
    () => ({ kind: ownerKind, id: ownerId }) as BlockOwner,
    [ownerKind, ownerId],
  );

  // Keep the callback in a ref so it never becomes a dependency of `flush` — a caller passing
  // an inline arrow would otherwise re-create flush on every render (see the note above).
  const report = useRef(onSaveStateChange);
  report.current = onSaveStateChange;

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!dirty.current || !workspaceId) return;
    dirty.current = false;
    inFlight.current = true;
    report.current?.("saving");
    void persistBlocks(stableOwner, workspaceId, editor.document as Block[]).then(
      () => {
        inFlight.current = false;
        clearDraft(draftKey(stableOwner.kind, stableOwner.id));
        report.current?.("saved");
      },
      () => {
        // Failed write: the content is still in the editor, so mark it unsaved again rather
        // than claiming success.
        inFlight.current = false;
        dirty.current = true;
        report.current?.("idle");
      },
    );
  }, [editor, stableOwner, workspaceId]);

  useEffect(() => flush, [flush]); // flush pending save on unmount / dep change

  /*
   * Also flush when the page is being hidden or torn down. Without this, reloading or closing
   * the tab within the debounce window silently dropped whatever had just been typed — the
   * unmount cleanup never runs on a real navigation. `pagehide` fires on reload/close/bfcache
   * and `visibilitychange` covers tab switches and mobile backgrounding.
   */
  useEffect(
    () =>
      onPageHidden(() => {
        // Synchronous, so it survives the teardown that the async save cannot.
        if (dirty.current || inFlight.current) {
          writeDraft(draftKey(stableOwner.kind, stableOwner.id), editor.document as Block[]);
        }
        flush();
      }),
    [flush, editor, stableOwner],
  );

  // Anything recovered from a previous session must be written through to the replica now.
  useEffect(() => {
    if (!recovered.current) return;
    recovered.current = null;
    dirty.current = true;
    flush();
    // Only on the first mount for this owner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableOwner]);

  const handleChange = useCallback(() => {
    dirty.current = true;
    report.current?.("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }, [flush]);

  const compact = variant === "compact";

  return (
    <div className={compact ? "tendto-compact-editor" : undefined}>
      <BlockNoteView
        editor={editor}
        onChange={handleChange}
        theme={theme}
        // The side menu IS the block chrome (drag handle + add button in the left gutter).
        // Dropping it is what turns this from "a document" into "a text box"; everything that
        // makes the content rich — markdown input rules, "/" — stays.
        sideMenu={!compact}
        tableHandles={!compact}
        // Compact swaps the floating selection toolbar for a persistent strip (below): in a
        // small field the formatting options should be visible without having to discover
        // that selecting text reveals them.
        formattingToolbar={!compact}
      >
        {compact ? (
          // A curated set, not the default one. The defaults add four alignment buttons, a
          // colour picker and nesting controls — in a card description that is the "endlessly
          // configurable" clutter the product avoids (docs/planning 03). Block type covers
          // headings/lists/quote/code; the rest is the formatting people actually reach for.
          <FormattingToolbar>
            <BlockTypeSelect key="block-type" />
            <BasicTextStyleButton basicTextStyle="bold" key="bold" />
            <BasicTextStyleButton basicTextStyle="italic" key="italic" />
            <BasicTextStyleButton basicTextStyle="strike" key="strike" />
            <BasicTextStyleButton basicTextStyle="code" key="code" />
            <CreateLinkButton key="link" />
          </FormattingToolbar>
        ) : null}
      </BlockNoteView>
    </div>
  );
}
