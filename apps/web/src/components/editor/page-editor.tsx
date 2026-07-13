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

import type { Block } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { loadBlocks, persistBlocks, rowToBlock, type BlockRow } from "../../lib/blocks/serialize";
import { renamePage } from "../../lib/pages";
import { db } from "../../lib/powersync/client";
import { useUiStore } from "../../stores/ui";
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
}

export function PageEditor({ pageId }: { pageId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null); // spinner while switching pages
    void Promise.all([
      loadBlocks(pageId),
      db.getAll<{ title: string }>("SELECT title FROM pages WHERE id = ?", [pageId]),
    ]).then(([blocks, rows]) => {
      if (!cancelled) setLoaded({ blocks, title: rows[0]?.title ?? "" });
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
    />
  );
}

interface PageEditorInnerProps {
  pageId: string;
  initialBlocks: BlockRow[];
  initialTitle: string;
}

function PageEditorInner({ pageId, initialBlocks, initialTitle }: PageEditorInnerProps) {
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);

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
    <div className="mx-auto min-h-full max-w-3xl px-6 py-10">
      <PageTitle pageId={pageId} initialTitle={initialTitle} />
      <BlockNoteView editor={editor} onChange={handleChange} />
    </div>
  );
}

/** Editable page title. Loaded once per page; commits debounced + on unmount (no reactive loop). */
function PageTitle({ pageId, initialTitle }: { pageId: string; initialTitle: string }) {
  const [title, setTitle] = useState(initialTitle);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(initialTitle);
  latest.current = title;

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void renamePage(pageId, latest.current.trim());
    };
  }, [pageId]);

  function onChange(value: string) {
    setTitle(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void renamePage(pageId, value.trim()), TITLE_DEBOUNCE_MS);
  }

  return (
    <input
      value={title}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Untitled"
      aria-label="Page title"
      data-testid="page-title"
      className="mb-3 w-full bg-transparent text-3xl font-bold text-neutral-900 outline-none placeholder:text-neutral-300"
    />
  );
}
