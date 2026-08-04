/**
 * Command palette — instant search over the local replica. Opened by the sidebar "Search…"
 * button or Cmd/Ctrl+K (wired in AppShell). Input is debounced ~150ms; results are grouped by
 * type. Enter opens the top result; Escape or a backdrop click closes.
 */
import { useNavigate } from "@tanstack/react-router";
import { Children, type ReactNode, useEffect, useRef, useState } from "react";

import {
  EMPTY_RESULTS,
  firstHit,
  searchWorkspace,
  totalHits,
  type SearchHit,
  type SearchResults,
} from "../../lib/search";
import { useUiStore } from "../../stores/ui";

export function SearchPalette() {
  const open = useUiStore((s) => s.searchOpen);
  const setOpen = useUiStore((s) => s.setSearchOpen);
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset + focus whenever the palette opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults(EMPTY_RESULTS);
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

  if (!open) return null;

  function go(hit: SearchHit): void {
    setOpen(false);
    if (hit.kind === "page") void navigate({ to: "/p/$pageId", params: { pageId: hit.id } });
    else if (hit.kind === "item")
      void navigate({ to: "/c/$collectionId", params: { collectionId: hit.collectionId } });
    else void navigate({ to: "/p/$pageId", params: { pageId: hit.pageId } });
  }

  const trimmed = query.trim();
  const hasResults = totalHits(results) > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      onClick={() => setOpen(false)}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 p-4 pt-[12vh]"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-elevated shadow-xl"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              const hit = firstHit(results);
              if (hit) go(hit);
            }
          }}
          placeholder="Search pages, items, blocks…"
          aria-label="Search query"
          className="w-full border-b border-line px-4 py-3 text-sm text-fg outline-none placeholder:text-subtle"
        />

        <div className="max-h-[52vh] overflow-y-auto py-2">
          {trimmed && !hasResults ? (
            <p className="px-4 py-6 text-center text-sm text-subtle">No results</p>
          ) : null}

          <ResultGroup label="Pages">
            {results.pages.map((hit) => (
              <ResultRow key={hit.id} badge="Page" label={hit.title} onSelect={() => go(hit)} />
            ))}
          </ResultGroup>
          <ResultGroup label="Items">
            {results.items.map((hit) => (
              <ResultRow key={hit.id} badge="Item" label={hit.title} onSelect={() => go(hit)} />
            ))}
          </ResultGroup>
          <ResultGroup label="Blocks">
            {results.blocks.map((hit) => (
              <ResultRow key={hit.id} badge="Block" label={hit.preview} onSelect={() => go(hit)} />
            ))}
          </ResultGroup>
        </div>

        <div className="border-t border-line px-4 py-2 text-xs text-subtle">
          Enter to open · Esc to close
        </div>
      </div>
    </div>
  );
}

function ResultGroup({ label, children }: { label: string; children: ReactNode }) {
  const items = Children.toArray(children);
  if (items.length === 0) return null;
  return (
    <section className="mb-1">
      <div className="px-4 py-1 text-xs font-medium uppercase tracking-wide text-subtle">
        {label}
      </div>
      <ul>{children}</ul>
    </section>
  );
}

function ResultRow({
  badge,
  label,
  onSelect,
}: {
  badge: string;
  label: string;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-muted hover:bg-hover"
      >
        <span className="shrink-0 rounded bg-hover px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted">
          {badge}
        </span>
        <span className="truncate">{label || "Untitled"}</span>
      </button>
    </li>
  );
}
