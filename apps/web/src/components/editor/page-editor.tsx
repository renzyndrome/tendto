/**
 * PageEditor — BlockNote wired to the local replica.
 *
 * The hydrate/persist loop is designed to NOT fight BlockNote's own document state:
 *
 *  - Hydrate ONCE per pageId via a one-shot read (`loadBlocks`), never a reactive query. The
 *    inner editor is keyed by pageId so switching pages remounts it with fresh initialContent.
 *    We deliberately do not re-hydrate an open editor when the replica changes — live external
 *    edits to the page you're editing are Phase 2.
 *  - Persist on change, debounced ~500ms, into the local db (`persistBlocks`). PowerSync's
 *    connector uploads the queued CRUD automatically. There is NO network code in this file.
 */
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import type { Block } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  loadBlocks,
  persistBlocks,
  rowToBlock,
  type BlockRow,
} from "../../lib/blocks/serialize";
import { useUiStore } from "../../stores/ui";
import { Spinner } from "../ui/spinner";

const SAVE_DEBOUNCE_MS = 500;

export function PageEditor({ pageId }: { pageId: string }) {
  const [blocks, setBlocks] = useState<BlockRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBlocks(null); // show the spinner while switching pages
    void loadBlocks(pageId).then((rows) => {
      if (!cancelled) setBlocks(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  if (blocks === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Loading page…" />
      </div>
    );
  }

  // key={pageId}: force a fresh editor per page so initialContent is applied on switch.
  return <PageEditorInner key={pageId} pageId={pageId} initialBlocks={blocks} />;
}

interface PageEditorInnerProps {
  pageId: string;
  initialBlocks: BlockRow[];
}

function PageEditorInner({ pageId, initialBlocks }: PageEditorInnerProps) {
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);

  const initialContent = useMemo(
    () => (initialBlocks.length > 0 ? initialBlocks.map(rowToBlock) : undefined),
    [initialBlocks],
  );

  const editor = useCreateBlockNote({ initialContent });

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

  // Flush any pending save when leaving the page (unmount) or before deps change.
  useEffect(() => flush, [flush]);

  const handleChange = useCallback(() => {
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }, [flush]);

  return (
    <div className="mx-auto min-h-full max-w-3xl px-6 py-10">
      <BlockNoteView editor={editor} onChange={handleChange} />
    </div>
  );
}
