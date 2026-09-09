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

import type { PartialBlock } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import {
  BasicTextStyleButton,
  BlockTypeSelect,
  CreateLinkButton,
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
  useComponentsContext,
  useCreateBlockNote,
} from "@blocknote/react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { loadEngineStatus, type AiTask } from "../../lib/ai/compose";
import { AiPanel } from "./ai-panel";
import { PAGE_LINK_ATTR } from "./page-link";
import { PageLinkMenu } from "./page-link-menu";
import { schema } from "./schema";

import {
  persistBlocks,
  rowToBlock,
  type BlockOwner,
  type BlockRow,
} from "../../lib/blocks/serialize";
import { clearDraft, draftKey, onPageHidden, readDraft, writeDraft } from "../../lib/drafts";
import { db } from "../../lib/powersync/client";
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

/** "Ask AI" in the selection toolbar, themed by BlockNote's own component set so it matches
 *  the buttons beside it rather than looking bolted on. */
function AskAiButton({ onClick }: { onClick: () => void }) {
  const Components = useComponentsContext();
  if (!Components) return null;
  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      mainTooltip="Rewrite, shorten, or fix the selected text"
      onClick={onClick}
    >
      {/* Children, not just `label`: the themed button renders `label` as an aria-label only,
          so a label-only button is a blank square on screen. */}
      Ask AI
    </Components.FormattingToolbar.Button>
  );
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

  /*
   * Interactive AI is offered only where it earns its place: page bodies, not card
   * descriptions. A card description is a sentence or two, and "summarize" is meaningless
   * there — the dialog stays as spare as docs/planning/03 asks it to be.
   */
  const [aiTasks, setAiTasks] = useState<AiTask[] | null>(null);
  const [aiRequest, setAiRequest] = useState<{ source: string; task?: string } | null>(null);
  /** How to put an accepted result back into the document. Set when the request is opened. */
  const applyRef = useRef<(text: string) => void>(() => undefined);

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
  // The default block set plus our `pageLink` inline node — see ./schema.
  const editor = useCreateBlockNote({ schema, initialContent, uploadFile: uploadInlineFile });

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
    void persistBlocks(stableOwner, workspaceId, editor.document).then(
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
          writeDraft(draftKey(stableOwner.kind, stableOwner.id), editor.document);
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

  // A programmatic edit must mark the document dirty exactly as typing does, or an accepted
  // AI result would sit in the editor unsaved. Via a ref because the AI callbacks above are
  // declared before `handleChange` exists.
  const handleChangeRef = useRef(handleChange);
  handleChangeRef.current = handleChange;

  const compact = variant === "compact";
  const aiEnabled = !compact;

  /*
   * Following a page link. ONE NATIVE listener on the editor container, in the capture phase.
   *
   * Native, not React's `onClickCapture`, and on the container rather than on the chip, because
   * BlockNote renders an inline node view through its OWN React root. React dispatches a
   * synthetic event only within the root that owns the target's fiber, so neither a handler on
   * the chip nor one on this container ever sees the click — the chip rendered perfectly and
   * clicking it did nothing at all. A real DOM listener sees every click, whichever root drew
   * the element.
   *
   * Capture phase also gets ahead of ProseMirror, which would otherwise treat the click as
   * "put the caret here" and re-render the node underneath it.
   */
  const navigate = useNavigate();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const chipFor = (event: Event): string | null => {
      const target = event.target as HTMLElement | null;
      return target?.closest<HTMLElement>(`[${PAGE_LINK_ATTR}]`)?.getAttribute(PAGE_LINK_ATTR) ?? null;
    };
    const onMouseDown = (event: Event) => {
      if (chipFor(event)) event.preventDefault(); // keep the caret out of the chip
    };
    const onClick = (event: Event) => {
      const pageId = chipFor(event);
      if (!pageId) return;
      event.preventDefault();
      event.stopPropagation();
      /*
       * Confirm the target still exists before going there. A page can be deleted while a link
       * to it is on screen, and opening an id that is gone renders an EMPTY editor: typing in it
       * would insert blocks whose page Postgres no longer has, the upload would be rejected, and
       * this device's ordered queue would wedge for good. The chip also paints itself as dead,
       * but that is presentation — this is the guard that has to hold.
       */
      void db
        .getAll<{ id: string }>("SELECT id FROM pages WHERE id = ?", [pageId])
        .then((rows) => {
          if (rows.length > 0) void navigate({ to: "/p/$pageId", params: { pageId } });
        })
        .catch(() => undefined);
    };

    surface.addEventListener("mousedown", onMouseDown, true);
    surface.addEventListener("click", onClick, true);
    return () => {
      surface.removeEventListener("mousedown", onMouseDown, true);
      surface.removeEventListener("click", onClick, true);
    };
  }, [navigate]);

  // Asked once per session and cached in the module; an empty list means no engine, and every
  // AI affordance simply never renders.
  useEffect(() => {
    if (!aiEnabled) return;
    let cancelled = false;
    void loadEngineStatus().then((status) => {
      if (!cancelled) setAiTasks(status.available ? status.tasks : []);
    });
    return () => {
      cancelled = true;
    };
  }, [aiEnabled]);

  /** Toolbar entry: work on what the user highlighted, and put the result back in its place. */
  const askAboutSelection = useCallback(() => {
    const text = editor.getSelectedText().trim();
    if (!text) return;
    applyRef.current = (result: string) => {
      /*
       * insertInlineContent, NOT replaceBlocks. `getSelection()` returns the WHOLE blocks a
       * selection touches — highlight one sentence of a paragraph and it hands back the entire
       * paragraph — while `getSelectedText()` returns only the highlighted words. Replacing
       * those blocks with a rewrite of the highlighted part therefore deletes the rest of the
       * paragraph. Inline insertion replaces exactly the range the user selected, and the
       * ProseMirror selection survives the panel taking DOM focus, so it is still the right
       * range when they press Keep.
       */
      editor.focus();
      editor.insertInlineContent(result);
      handleChangeRef.current();
    };
    setAiRequest({ source: text });
  }, [editor]);

  /** Page entry: summarize the whole document, and put the summary at the top of it. */
  const summarizePage = useCallback(() => {
    // Markdown, not plain text: headings and lists are most of what makes a page summarizable,
    // and flattening them throws that structure away before the model ever sees it.
    const markdown = editor.blocksToMarkdownLossy(editor.document);
    if (!markdown.trim()) return;
    applyRef.current = (result: string) => {
      const blocks = editor.tryParseMarkdownToBlocks(result);
      const first = editor.document[0];
      // An empty parse would be a no-op here, but `replaceBlocks` elsewhere treats it as
      // "delete and insert nothing" — so never hand either of them an empty list.
      if (blocks.length === 0 || !first) return;
      editor.insertBlocks(blocks, first.id, "before");
      handleChangeRef.current();
    };
    setAiRequest({ source: markdown, task: "summarize" });
  }, [editor]);


  const hasAi = aiEnabled && aiTasks !== null && aiTasks.length > 0;

  // A stable component identity. FormattingToolbarController renders whatever it is handed as
  // a COMPONENT, so a fresh inline arrow each render is a new type — React unmounts and remounts
  // the toolbar, closing any dropdown or link popover that happened to be open.
  const pageToolbar = useMemo(
    () =>
      function PageToolbar() {
        return (
          <FormattingToolbar>
            {...getFormattingToolbarItems()}
            {hasAi ? <AskAiButton key="ask-ai" onClick={askAboutSelection} /> : <></>}
          </FormattingToolbar>
        );
      },
    [hasAi, askAboutSelection],
  );

  return (
    <div ref={surfaceRef} className={compact ? "tendto-compact-editor" : undefined}>
      {hasAi ? (
        // Quiet and right-aligned: a page you never want summarized should not have to look at
        // a prominent button forever. It is absent entirely when no engine is configured.
        <div className="mb-1 flex justify-end">
          <button
            type="button"
            onClick={summarizePage}
            data-testid="summarize-page"
            className="rounded px-2 py-1 text-xs text-subtle hover:bg-hover hover:text-fg"
          >
            Summarize
          </button>
        </div>
      ) : null}

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
        // that selecting text reveals them. The page variant also opts out of the DEFAULT
        // toolbar, but only so it can render the same one plus "Ask AI" (below).
        formattingToolbar={false}
      >
        <PageLinkMenu
          editor={editor}
          workspaceId={workspaceId}
          currentPageId={stableOwner.kind === "page" ? stableOwner.id : null}
        />

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
        ) : (
          // The stock floating toolbar, item for item, with one addition. Rebuilding it from
          // `getFormattingToolbarItems()` is what lets "Ask AI" sit beside the formatting
          // controls instead of somewhere the user has to go looking for it.
          <FormattingToolbarController formattingToolbar={pageToolbar} />
        )}
      </BlockNoteView>

      {aiRequest && aiTasks ? (
        <AiPanel
          source={aiRequest.source}
          // A selection is offered only the rewriting tasks. Summarizing a highlighted sentence
          // returns bullet points, and inline insertion would drop a bullet list into the middle
          // of a paragraph — summarizing is what the page-level button is for.
          tasks={aiRequest.task ? aiTasks : aiTasks.filter((task) => !task.whole_document)}
          initialTask={aiRequest.task}
          onApply={(text) => applyRef.current(text)}
          onClose={() => setAiRequest(null)}
        />
      ) : null}
    </div>
  );
}
