/**
 * PageEditor — an editable title + BlockNote wired to the local replica.
 *
 * The hydrate/persist loop is designed to NOT fight BlockNote's own document state:
 *  - Hydrate ONCE per pageId via a one-shot read (title + blocks), never a reactive query. The
 *    inner editor is keyed by pageId so switching pages remounts it with fresh content.
 *  - Persist on change, debounced, into the local db. PowerSync's connector uploads the queued
 *    CRUD automatically. There is NO network code in this file.
 */
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import type { Block, PartialBlock } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { loadBlocks, persistBlocks, rowToBlock, type BlockRow } from "../../lib/blocks/serialize";
import { renamePage } from "../../lib/pages";
import { db } from "../../lib/powersync/client";
import { useUiStore } from "../../stores/ui";
import { TopBar, TopBarActions } from "../layout/top-bar";
import { Spinner } from "../ui/spinner";

const SAVE_DEBOUNCE_MS = 500;
const TITLE_DEBOUNCE_MS = 400;
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

interface Loaded {
  blocks: BlockRow[];
  title: string;
  updatedAt: string;
}

export function PageEditor({ pageId }: { pageId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null); // spinner while switching pages
    void Promise.all([
      loadBlocks(pageId),
      db.getAll<{ title: string; updated_at: string }>(
        "SELECT title, updated_at FROM pages WHERE id = ?",
        [pageId],
      ),
    ]).then(([blocks, rows]) => {
      if (!cancelled)
        setLoaded({ blocks, title: rows[0]?.title ?? "", updatedAt: rows[0]?.updated_at ?? "" });
    });
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  if (loaded === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Loading page…" />
      </div>
    );
  }

  // key={pageId}: fresh editor + title per page so initial content is applied on switch.
  return (
    <PageEditorInner
      key={pageId}
      pageId={pageId}
      initialBlocks={loaded.blocks}
      initialTitle={loaded.title}
      initialUpdatedAt={loaded.updatedAt}
    />
  );
}

/** "Edited 2m ago"-style relative label from an ISO timestamp (reflects the last save at open). */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface PageEditorInnerProps {
  pageId: string;
  initialBlocks: BlockRow[];
  initialTitle: string;
  initialUpdatedAt: string;
}

function PageEditorInner({
  pageId,
  initialBlocks,
  initialTitle,
  initialUpdatedAt,
}: PageEditorInnerProps) {
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);
  // Title is lifted here so the breadcrumb and the <PageTitle> input stay in sync; PageTitle still
  // owns the debounced + on-unmount persistence (unchanged).
  const [title, setTitle] = useState(initialTitle);

  const initialContent = useMemo(
    () => (initialBlocks.length > 0 ? initialBlocks.map(rowToBlock) : undefined),
    [initialBlocks],
  );
  const editor = useCreateBlockNote({ initialContent, uploadFile: uploadInlineFile });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!dirty.current || !workspaceId) return;
    dirty.current = false;
    void persistBlocks(pageId, workspaceId, editor.document as Block[]);
  }, [editor, pageId, workspaceId]);

  useEffect(() => flush, [flush]); // flush pending save on unmount / dep change

  const handleChange = useCallback(() => {
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }, [flush]);

  return (
    <div className="flex h-full flex-col">
      <TopBar
        crumbs={[{ label: "Pages" }, { label: title.trim() || "Untitled" }]}
        right={
          <TopBarActions
            meta={initialUpdatedAt ? `Edited ${relativeTime(initialUpdatedAt)}` : undefined}
          />
        }
      />
      <div className="flex-1 overflow-y-auto bg-canvas">
        <div className="mx-auto max-w-doc px-6 pb-24 pt-11 md:px-8">
          <PageTitle
            pageId={pageId}
            value={title}
            onChange={setTitle}
            onEnter={() => {
              // Jump from the title into the first block, like Notion; Enter then makes new blocks.
              const first = editor.document[0];
              if (first) editor.setTextCursorPosition(first, "end");
              editor.focus();
            }}
          />
          <BlockNoteView editor={editor} onChange={handleChange} className="font-doc" />
        </div>
        <MobileBlockToolbar editor={editor} />
      </div>
    </div>
  );
}

/** Editable page title. Value is controlled by the parent; commits debounced + on unmount.
 *  Enter moves focus into the editor body (onEnter) instead of inserting a newline. */
function PageTitle({
  pageId,
  value,
  onChange,
  onEnter,
}: {
  pageId: string;
  value: string;
  onChange: (value: string) => void;
  onEnter: () => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void renamePage(pageId, latest.current.trim());
    };
  }, [pageId]);

  function handleChange(next: string) {
    onChange(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void renamePage(pageId, next.trim()), TITLE_DEBOUNCE_MS);
  }

  return (
    <input
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || (e.key === "ArrowDown" && e.currentTarget.selectionStart === value.length)) {
          e.preventDefault();
          onEnter();
        }
      }}
      placeholder="Untitled"
      aria-label="Page title"
      data-testid="page-title"
      className="mb-4 w-full bg-transparent font-doc text-doc-title text-ink outline-none placeholder:text-chevron"
    />
  );
}

/** A block config for the mobile insert bar — a glyph + the partial block it inserts. */
interface ToolbarBlock {
  glyph: string;
  label: string;
  block: PartialBlock;
  mono?: boolean;
}

// Curated block set only (design 1e): text, to-do, toggle, code. All exist in @blocknote/core 0.51.
const TOOLBAR_BLOCKS: ToolbarBlock[] = [
  { glyph: "Aa", label: "Text", block: { type: "paragraph" } },
  { glyph: "✓", label: "To-do", block: { type: "checkListItem" } },
  { glyph: "▸", label: "Toggle", block: { type: "toggleListItem" } },
  { glyph: "{}", label: "Code", block: { type: "codeBlock" }, mono: true },
];

/**
 * Mobile-only block insert bar (design 1e), pinned above the keyboard at the bottom of the doc
 * column. Each button inserts a block after the current cursor block; the trailing ⌄ dismisses the
 * keyboard by blurring the editor. Insert calls are guarded so a failure never throws in the UI.
 */
function MobileBlockToolbar({ editor }: { editor: ReturnType<typeof useCreateBlockNote> }) {
  const insertBlock = useCallback(
    (block: PartialBlock) => {
      try {
        const reference = editor.getTextCursorPosition().block;
        editor.insertBlocks([block], reference, "after");
        editor.focus();
      } catch {
        // Swallow — an insert failure must never crash the editor surface.
      }
    },
    [editor],
  );

  const dismiss = useCallback(() => {
    try {
      editor.blur();
    } catch {
      // ignore
    }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }, [editor]);

  return (
    <div className="sticky bottom-0 border-t border-hairline bg-panel pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="flex items-center gap-1 overflow-hidden px-2.5 py-2">
        <button
          type="button"
          onClick={() => insertBlock({ type: "paragraph" })}
          aria-label="Insert block"
          className="flex h-10 min-w-[44px] items-center justify-center rounded-[9px] border border-border-soft bg-canvas text-[16px] text-secondary"
        >
          +
        </button>
        {TOOLBAR_BLOCKS.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => insertBlock(item.block)}
            aria-label={item.label}
            className={
              "flex h-10 min-w-[44px] items-center justify-center rounded-[9px] font-medium text-secondary hover:bg-btn-hover " +
              (item.mono ? "font-mono text-[12px]" : "text-[13px]")
            }
          >
            {item.glyph}
          </button>
        ))}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss keyboard"
          className="ml-auto flex h-10 min-w-[44px] items-center justify-center rounded-[9px] text-[13px] text-muted hover:bg-btn-hover"
        >
          ⌄
        </button>
      </div>
    </div>
  );
}
