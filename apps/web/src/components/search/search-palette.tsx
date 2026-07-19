/**
 * Quick switcher (Meadow) — instant search over the local replica. Opened by the sidebar
 * "Search…" button or Cmd/Ctrl+K (wired in AppShell). Input is debounced ~150ms; results are
 * grouped by type (pages → items → blocks) with fuzzy-match highlight. A flat keyboard cursor
 * spans every visible row (including the "Create page" row): ↑/↓ move it, Enter opens the
 * selected row, ⌘/Ctrl+↵ creates a page from the query. Escape or a backdrop click closes.
 */
import { useNavigate } from "@tanstack/react-router";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";

import { createPage, renamePage } from "../../lib/pages";
import {
  EMPTY_RESULTS,
  highlightMatch,
  searchWorkspace,
  totalHits,
  type SearchHit,
  type SearchResults,
} from "../../lib/search";
import { useUiStore } from "../../stores/ui";
import { Icon, type IconName } from "../ui/icon";
import { Kbd } from "../ui/kbd";

/** A single selectable row in the flat keyboard list. */
interface FlatRow {
  key: string;
  icon: IconName;
  label: string;
  group: string; // right-aligned group name for hits; empty for the create row
  isCreate: boolean;
  onSelect: () => void;
}

export function SearchPalette() {
  const open = useUiStore((s) => s.searchOpen);
  const setOpen = useUiStore((s) => s.setSearchOpen);
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const creating = useRef(false); // guards ⌘↵ against a double-fire creating two pages

  // Reset + focus whenever the palette opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults(EMPTY_RESULTS);
    setSelectedIndex(0);
    const focus = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(focus);
  }, [open]);

  // Debounced search against the replica.
  useEffect(() => {
    if (!open || !workspaceId) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(EMPTY_RESULTS);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void searchWorkspace(workspaceId, trimmed).then((next) => {
        if (!cancelled) setResults(next);
      });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, open, workspaceId]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const trimmed = query.trim();

  function go(hit: SearchHit): void {
    setOpen(false);
    if (hit.kind === "page") void navigate({ to: "/p/$pageId", params: { pageId: hit.id } });
    else if (hit.kind === "item")
      void navigate({ to: "/c/$collectionId", params: { collectionId: hit.collectionId } });
    else void navigate({ to: "/p/$pageId", params: { pageId: hit.pageId } });
  }

  async function handleCreate(): Promise<void> {
    if (!workspaceId || creating.current) return;
    creating.current = true;
    try {
      const title = trimmed;
      const id = await createPage(workspaceId, null);
      if (title) await renamePage(id, title);
      void navigate({ to: "/p/$pageId", params: { pageId: id } });
      setOpen(false);
    } finally {
      creating.current = false;
    }
  }

  // Flat list of every visible row, in display order, ending with the create row when typing.
  const rows: FlatRow[] = [];
  for (const hit of results.pages)
    rows.push({
      key: `page:${hit.id}`,
      icon: "page",
      label: hit.title || "Untitled",
      group: "Pages",
      isCreate: false,
      onSelect: () => go(hit),
    });
  for (const hit of results.items)
    rows.push({
      key: `item:${hit.id}`,
      icon: "board",
      label: hit.title || "Untitled",
      group: "Items",
      isCreate: false,
      onSelect: () => go(hit),
    });
  for (const hit of results.blocks)
    rows.push({
      key: `block:${hit.id}`,
      icon: "hash",
      label: hit.preview || "Untitled",
      group: "Blocks",
      isCreate: false,
      onSelect: () => go(hit),
    });
  if (trimmed)
    rows.push({
      key: "create",
      icon: "plus",
      label: `Create page “${trimmed}”`,
      group: "",
      isCreate: true,
      onSelect: () => void handleCreate(),
    });

  // Reset the cursor whenever the visible set changes.
  useEffect(() => {
    setSelectedIndex(0);
  }, [results, trimmed]);

  // Keep the highlighted row on screen as the cursor moves.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!open) return null;

  const selected = rows.length > 0 ? Math.min(selectedIndex, rows.length - 1) : -1;
  const hasResults = totalHits(results) > 0;

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, rows.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) {
        void handleCreate();
        return;
      }
      rows[selected]?.onSelect();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      onClick={() => setOpen(false)}
      className="fixed inset-0 z-50 overflow-y-auto bg-[rgba(31,29,24,.32)] px-4"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="mx-auto mt-[12vh] w-full max-w-[520px] animate-pop-in overflow-hidden rounded-[14px] border border-hairline bg-surface shadow-modal"
      >
        {/* Search row */}
        <div className="flex items-center gap-2.5 border-b border-hairline px-[18px] py-3.5">
          <Icon name="search" size={15} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search pages, items, blocks…"
            aria-label="Search query"
            className="flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted"
          />
          <Kbd>esc</Kbd>
        </div>

        {/* Results */}
        <div className="max-h-[52vh] overflow-y-auto p-1.5">
          {trimmed && !hasResults ? (
            <p className="px-3 py-6 text-center text-[13px] text-muted">No results</p>
          ) : null}

          {rows.map((row, index) => {
            const isSelected = index === selected;
            return (
              <button
                key={row.key}
                type="button"
                ref={isSelected ? selectedRef : undefined}
                onClick={row.onSelect}
                onMouseMove={() => setSelectedIndex(index)}
                className={
                  "flex w-full items-center gap-[11px] rounded-[8px] px-3 py-[9px] text-left " +
                  (isSelected ? "bg-accent-soft" : "hover:bg-row-hover")
                }
              >
                <Icon name={row.icon} size={14} className="shrink-0 text-muted" />
                <span
                  className={
                    "min-w-0 flex-1 truncate text-[13.5px] " +
                    (isSelected
                      ? "font-medium text-accent-soft-text"
                      : row.isCreate
                        ? "text-secondary"
                        : "text-body")
                  }
                >
                  {row.isCreate ? row.label : <Highlight text={row.label} query={trimmed} />}
                </span>
                {row.isCreate ? (
                  <Kbd className="ml-auto">⌘↵</Kbd>
                ) : (
                  <span className="ml-auto shrink-0 text-[11px] text-faint">{row.group}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer legend */}
        <div className="flex gap-3.5 border-t border-hairline px-[18px] py-[9px] text-[10.5px] text-faint">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>⌘↵ create</span>
        </div>
      </div>
    </div>
  );
}

/** Renders a label with the matched substring wrapped in an accent-soft <mark>. */
function Highlight({ text, query }: { text: string; query: string }) {
  const segments = highlightMatch(text || "Untitled", query);
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark
            key={index}
            className="rounded-[3px] bg-accent-soft-strong px-0.5 text-accent-soft-text"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
