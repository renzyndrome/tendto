/**
 * PageEditor — an editable title + the shared BlockEditor, wired to the local replica.
 *
 * Blocks are hydrated ONCE per pageId via a one-shot read (never a reactive query, which would
 * fight BlockNote's own document state); the inner editor is keyed by pageId so switching pages
 * remounts it with fresh content. Persistence lives in BlockEditor — the same component the
 * card description uses.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { loadBlocks, pageOwner, type BlockRow } from "../../lib/blocks/serialize";
import { clearDraft, draftKey, onPageHidden, readDraft, writeDraft } from "../../lib/drafts";
import { renamePage } from "../../lib/pages";
import { db } from "../../lib/powersync/client";
import { useUiStore } from "../../stores/ui";
import { Spinner } from "../ui/spinner";
import { BlockEditor } from "./block-editor";

const TITLE_DEBOUNCE_MS = 400;

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
      loadBlocks(pageOwner(pageId)),
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

  return (
    <div className="mx-auto min-h-full max-w-3xl px-6 py-10">
      <PageTitle pageId={pageId} initialTitle={initialTitle} />
      <BlockEditor
        owner={pageOwner(pageId)}
        workspaceId={workspaceId}
        initialBlocks={initialBlocks}
      />
    </div>
  );
}

/**
 * Editable page title. Loaded once per page; commits debounced + on unmount (no reactive loop),
 * with the same crash-safe stash as every other editor here — a reload while the title still
 * had focus used to lose it, because the rename is an async write the browser won't wait for.
 */
function PageTitle({ pageId, initialTitle }: { pageId: string; initialTitle: string }) {
  const key = draftKey("page-title", pageId);
  const [title, setTitle] = useState(() => readDraft<string>(key) ?? initialTitle);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(title);
  latest.current = title;

  const commit = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    void renamePage(pageId, latest.current.trim()).then(() => clearDraft(key));
  }, [pageId, key]);

  useEffect(() => {
    // Replay anything recovered from a session that was torn down mid-edit.
    if (readDraft<string>(key) !== null) commit();
    return commit;
  }, [commit, key]);

  useEffect(
    () =>
      onPageHidden(() => {
        writeDraft(key, latest.current);
        commit();
      }),
    [commit, key],
  );

  function onChange(value: string) {
    setTitle(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(commit, TITLE_DEBOUNCE_MS);
  }

  return (
    <input
      value={title}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Untitled"
      aria-label="Page title"
      data-testid="page-title"
      className="mb-3 w-full bg-transparent text-3xl font-bold text-fg outline-none placeholder:text-subtle"
    />
  );
}
