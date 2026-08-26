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
import { usePresence } from "../../lib/presence/use-presence";
import { useUiStore } from "../../stores/ui";
import { CommentSection } from "../comments/comment-section";
import { PresenceBar } from "../presence/presence-bar";
import { Spinner } from "../ui/spinner";
import { BlockEditor } from "./block-editor";

const TITLE_DEBOUNCE_MS = 400;

interface Loaded {
  blocks: BlockRow[];
  title: string;
  workspaceId: string | null;
}

export function PageEditor({ pageId }: { pageId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null); // spinner while switching pages
    void Promise.all([
      loadBlocks(pageOwner(pageId)),
      db.getAll<{ title: string; workspace_id: string }>(
        "SELECT title, workspace_id FROM pages WHERE id = ?",
        [pageId],
      ),
    ]).then(([blocks, rows]) => {
      if (!cancelled) {
        setLoaded({
          blocks,
          title: rows[0]?.title ?? "",
          // THIS page's workspace, not whichever one the sidebar is showing — a comment must be
          // pinned where its page lives or the people reading that page won't receive it.
          workspaceId: rows[0]?.workspace_id ?? null,
        });
      }
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
      pageWorkspaceId={loaded.workspaceId}
    />
  );
}

interface PageEditorInnerProps {
  pageId: string;
  initialBlocks: BlockRow[];
  initialTitle: string;
  pageWorkspaceId: string | null;
}

function PageEditorInner({
  pageId,
  initialBlocks,
  initialTitle,
  pageWorkspaceId,
}: PageEditorInnerProps) {
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);
  // THIS page's workspace only, with no fallback to the sidebar's: presence is keyed on
  // (workspace, page), so filing it under the wrong workspace would put you in a room the
  // page's actual readers are not in. Null (page not in the replica yet) simply means no poll.
  const others = usePresence(pageWorkspaceId, { kind: "page", id: pageId });

  return (
    <div className="mx-auto min-h-full max-w-3xl px-6 py-10">
      {/* Above the title and right-aligned, so it reads as "about this page" and takes no
          vertical space when nobody else is here (the usual case: it renders nothing). */}
      <div className="flex justify-end">
        <PresenceBar others={others} />
      </div>
      <PageTitle pageId={pageId} initialTitle={initialTitle} />
      <BlockEditor
        owner={pageOwner(pageId)}
        workspaceId={workspaceId}
        initialBlocks={initialBlocks}
      />
      {/* Below the body, in the same column: a page's discussion belongs after the page, not in
          a side panel competing with it for attention. */}
      <div className="mt-10 border-t border-line pt-5">
        <CommentSection
          owner={{ kind: "page", id: pageId }}
          workspaceId={pageWorkspaceId ?? workspaceId}
        />
      </div>
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
