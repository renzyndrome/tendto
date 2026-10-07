/**
 * PageEditor — an editable title + the shared BlockEditor, wired to the local replica.
 *
 * Blocks are hydrated ONCE per pageId via a one-shot read (never a reactive query, which would
 * fight BlockNote's own document state); the inner editor is keyed by pageId so switching pages
 * remounts it with fresh content. Persistence lives in BlockEditor — the same component the
 * card description uses.
 */
import { useQuery } from "@powersync/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useExternalEdit } from "../../lib/blocks/external-edit";
import { exactTime, shortDate, timeAgo } from "../../lib/comments/format";
import { loadBlocks, pageOwner, type BlockRow } from "../../lib/blocks/serialize";
import { clearDraft, draftKey, onPageHidden, readDraft, writeDraft } from "../../lib/drafts";
import { usePageStamps } from "../../lib/page-stamps";
import { isAutoTitle, renamePage } from "../../lib/pages";
import { db } from "../../lib/powersync/client";
import { usePresence } from "../../lib/presence/use-presence";
import { useUiStore } from "../../stores/ui";
import { CommentSection } from "../comments/comment-section";
import { PresenceBar } from "../presence/presence-bar";
import { Spinner } from "../ui/spinner";
import { BlockEditor } from "./block-editor";
import { PageConnections } from "./page-connections";
import { UpdatedElsewhere } from "./updated-elsewhere";

const TITLE_DEBOUNCE_MS = 400;

interface Loaded {
  blocks: BlockRow[];
  title: string;
  workspaceId: string | null;
}

export function PageEditor({ pageId }: { pageId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Bumped to re-read the page from the replica after an edit arrived from another device.
  // A targeted re-hydrate, not `location.reload()`: the rest of the app is already live.
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((n) => n + 1), []);

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
  }, [pageId, revision]);

  if (loaded === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Loading page…" />
      </div>
    );
  }

  // key: a fresh editor + title per page (so initial content is applied on switch) AND per
  // reload (so re-hydrated content replaces what BlockNote is holding).
  return (
    <PageEditorInner
      key={`${pageId}:${revision}`}
      pageId={pageId}
      onReload={reload}
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
  onReload: () => void;
}

function PageEditorInner({
  pageId,
  initialBlocks,
  initialTitle,
  pageWorkspaceId,
  onReload,
}: PageEditorInnerProps) {
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);
  // THIS page's workspace only, with no fallback to the sidebar's: presence is keyed on
  // (workspace, page), so filing it under the wrong workspace would put you in a room the
  // page's actual readers are not in. Null (page not in the replica yet) simply means no poll.
  const others = usePresence(pageWorkspaceId, { kind: "page", id: pageId });
  // This body was hydrated once; say so when the replica moves on without us.
  const external = useExternalEdit(pageOwner(pageId));

  return (
    // tendto-page-column: horizontal padding lives in index.css, sized to the editor's gutter.
    // Anchored to the sidebar rather than centered: on a wide screen a centered column left a
    // wide empty band between the sidebar and the page. Spare width now collects on the right.
    <div className="tendto-page-column ml-10 min-h-full max-w-3xl py-10">
      {/* Above the title and right-aligned, so it reads as "about this page" and takes no
          vertical space when nobody else is here (the usual case: it renders nothing). */}
      <div className="flex justify-end">
        <PresenceBar others={others} />
      </div>
      <PageTitle pageId={pageId} initialTitle={initialTitle} />
      <PageStamps pageId={pageId} />
      {external.changed ? <UpdatedElsewhere onReload={onReload} /> : null}
      <BlockEditor
        owner={pageOwner(pageId)}
        workspaceId={workspaceId}
        initialBlocks={initialBlocks}
      />
      {/* What points here, before the discussion about it. Renders nothing when nothing does. */}
      <PageConnections workspaceId={pageWorkspaceId ?? workspaceId} pageId={pageId} />

      {/* Below the body, in the same column: a page's discussion belongs after the page, not in
          a side panel competing with it for attention. */}
      <PageDiscussion pageId={pageId} workspaceId={pageWorkspaceId ?? workspaceId} />
    </div>
  );
}

/**
 * The page's comment thread, kept away until the page has something to discuss.
 *
 * A blank page offering a comment box is asking you to talk about nothing. A page counts as
 * real once it has been written on OR named by hand — either is somebody deciding it exists.
 * Both are read from the replica rather than from the editor, deliberately: a signal routed
 * through this component's parent would re-render the editor on the first keystroke and close
 * whatever toolbar was open. This is a sibling, so its own re-renders cost the editor nothing.
 *
 * Emptying a page again leaves its blocks in place, so a thread never disappears out from under
 * a conversation.
 */
function PageDiscussion({ pageId, workspaceId }: { pageId: string; workspaceId: string | null }) {
  const { data: rows, isLoading } = useQuery<{ title: string; blocks: number }>(
    `SELECT p.title AS title,
            (SELECT count(*) FROM blocks WHERE page_id = p.id) AS blocks
       FROM pages p WHERE p.id = ?`,
    [pageId],
  );
  // An empty array is also what the hook reports while it is still loading.
  const row = isLoading ? undefined : rows[0];
  // Written on, or named by hand. Either makes it a page somebody might discuss.
  const started = row !== undefined && (row.blocks > 0 || !isAutoTitle(row.title));

  return (
    <CommentSection
      owner={{ kind: "page", id: pageId }}
      workspaceId={workspaceId}
      hideWhenEmpty={!started}
    />
  );
}

/**
 * When this page was made, and when it was last touched — one quiet line under the title.
 *
 * Renders nothing until both reads have settled, rather than flickering a wrong date into
 * place. "Edited" is dropped when it would only repeat the creation date, which is the common
 * case for a page written in one sitting.
 */
function PageStamps({ pageId }: { pageId: string }) {
  const { createdAt, editedAt } = usePageStamps(pageId);
  if (createdAt === null) return null;

  const edited = editedAt !== null && editedAt - createdAt > 60_000;

  return (
    <p data-testid="page-stamps" className="-mt-2 mb-4 text-xs text-subtle">
      <span title={exactTime(createdAt)}>Created {shortDate(createdAt)}</span>
      {edited ? (
        <>
          <span aria-hidden> · </span>
          <span title={exactTime(editedAt)}>Edited {timeAgo(editedAt)}</span>
        </>
      ) : null}
    </p>
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
    /*
     * A title that has not changed is not written back. This is not only about saving an
     * upload: the commit also runs on unmount, and if this editor was hydrated before its
     * page's row reached the replica it holds an empty string — which it would then save over
     * a perfectly good name. Two pages both showing as "Untitled" in the sidebar was that,
     * with the fallback hiding the empty title.
     */
    const next = latest.current.trim();
    if (next === initialTitle.trim()) return;
    void renamePage(pageId, next).then(() => clearDraft(key));
  }, [pageId, key, initialTitle]);

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
      /*
       * An app-chosen name selects itself when you click into it, so the first thing you type
       * replaces it. It has to be a real value rather than a placeholder — the sidebar has to
       * call the page something, and three blank pages all called "Untitled" are worse than a
       * word you have to type over. Selecting it gives you the placeholder's feel with a real
       * name behind it. A name you chose is left exactly where your cursor landed.
       */
      onFocus={(e) => {
        if (isAutoTitle(e.currentTarget.value)) e.currentTarget.select();
      }}
      placeholder="Untitled"
      aria-label="Page title"
      data-testid="page-title"
      className="mb-3 w-full bg-transparent text-3xl font-bold text-fg outline-none placeholder:text-subtle"
    />
  );
}
