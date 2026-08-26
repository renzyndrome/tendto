/**
 * CollectionView — one collection rendered as one of four projections of the SAME items:
 * checklist · list · table · board (kanban). Switching a view is pure rendering; it never
 * migrates data. Items stream from the local replica via a reactive query, so edits from any
 * view (or a synced-down change) re-render instantly.
 */
import { useQuery } from "@powersync/react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { createItem, parseColumns, type ItemRow } from "../../lib/items/mutations";
import { db } from "../../lib/powersync/client";
import { useUiStore } from "../../stores/ui";
import { ItemDetail } from "./item-detail";
import { Spinner } from "../ui/spinner";
import { BoardView } from "./views/board-view";
import { ChecklistView } from "./views/checklist-view";
import { ListView } from "./views/list-view";
import { TableView } from "./views/table-view";

const VIEWS = ["checklist", "list", "table", "board"] as const;
export type CollectionViewKind = (typeof VIEWS)[number];

const VIEW_LABELS: Record<CollectionViewKind, string> = {
  checklist: "Checklist",
  list: "List",
  table: "Table",
  board: "Board",
};

interface CollectionRow {
  id: string;
  name: string;
  default_view: string;
  config: string;
}

function isViewKind(value: string | undefined): value is CollectionViewKind {
  return value === "checklist" || value === "list" || value === "table" || value === "board";
}

interface CollectionViewProps {
  collectionId: string;
  /** From the /c/$collectionId/i/$itemId route — the card whose detail dialog is open. */
  openItemId?: string;
}

export function CollectionView({ collectionId, openItemId }: CollectionViewProps) {
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);
  const navigate = useNavigate();

  const { data: collections, isLoading } = useQuery<CollectionRow>(
    "SELECT id, name, default_view, config FROM collections WHERE id = ?",
    [collectionId],
  );
  const { data: items } = useQuery<ItemRow>(
    "SELECT * FROM items WHERE collection_id = ? ORDER BY position",
    [collectionId],
  );

  const collection = collections[0];
  const [override, setOverride] = useState<CollectionViewKind | null>(null);
  const columns = useMemo(() => parseColumns(collection?.config), [collection?.config]);
  const openRow = openItemId ? items.find((item) => item.id === openItemId) : undefined;
  const view: CollectionViewKind =
    override ?? (isViewKind(collection?.default_view) ? collection.default_view : "board");

  if (isLoading && !collection) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Loading…" />
      </div>
    );
  }
  if (!collection) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-subtle">This collection no longer exists.</p>
      </div>
    );
  }

  async function switchView(next: CollectionViewKind): Promise<void> {
    setOverride(next);
    // Remember the choice on the collection so it reopens the same way (row-level write, syncs).
    await db.execute("UPDATE collections SET default_view = ?, updated_at = ? WHERE id = ?", [
      next,
      new Date().toISOString(),
      collectionId,
    ]);
  }

  function openItem(itemId: string): void {
    void navigate({ to: "/c/$collectionId/i/$itemId", params: { collectionId, itemId } });
  }

  function closeItem(): void {
    void navigate({ to: "/c/$collectionId", params: { collectionId } });
  }

  /**
   * Views where the title can be typed inline (checklist, table) just get a new row — opening a
   * modal there would break fast capture. Board and list render the title read-only, so a new
   * item there opens its detail with the title focused, which keeps capture to one flow.
   */
  async function handleNewItem(status?: string, forceOpen = false): Promise<void> {
    if (!workspaceId) return;
    const id = await createItem(workspaceId, collectionId, {
      title: "",
      status: status ?? columns[0]?.id,
    });
    if (forceOpen || view === "board" || view === "list") openItem(id);
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col px-6 py-8">
      <header className="mb-4 flex items-center justify-between gap-4">
        <CollectionName collectionId={collectionId} name={collection.name} />
        <button
          type="button"
          onClick={() => void handleNewItem()}
          className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
        >
          + New item
        </button>
      </header>

      <div className="mb-4 flex gap-1 border-b border-line">
        {VIEWS.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => void switchView(kind)}
            className={
              "rounded-t-md px-3 py-1.5 text-sm " +
              (kind === view
                ? "border-b-2 border-fg font-medium text-fg"
                : "text-muted hover:text-fg")
            }
          >
            {VIEW_LABELS[kind]}
          </button>
        ))}
      </div>

      {openItemId && openRow ? (
        // key: going card → card navigates without unmounting, so state initialised from the
        // row (the title draft) and anything scoped to the card (its presence) would carry
        // over from the previous one for a beat.
        <ItemDetail
          key={openItemId}
          row={openRow}
          columns={columns}
          workspaceId={workspaceId}
          onClose={closeItem}
          onDeleted={closeItem}
        />
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {view === "checklist" ? (
          <ChecklistView items={items} columns={columns} />
        ) : view === "list" ? (
          <ListView items={items} columns={columns} />
        ) : view === "table" ? (
          <TableView items={items} columns={columns} workspaceId={workspaceId} onOpen={openItem} />
        ) : (
          <BoardView
            items={items}
            collectionId={collectionId}
            columns={columns}
            onOpen={openItem}
            onAdd={(status) => void handleNewItem(status, true)}
          />
        )}
      </div>
    </div>
  );
}

/** Inline-editable collection name (commits on blur / Enter). */
function CollectionName({ collectionId, name }: { collectionId: string; name: string }) {
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);

  async function commit(): Promise<void> {
    const trimmed = value.trim() || "Untitled";
    if (trimmed === name) return;
    await db.execute("UPDATE collections SET name = ?, updated_at = ? WHERE id = ?", [
      trimmed,
      new Date().toISOString(),
      collectionId,
    ]);
  }

  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      placeholder="Untitled"
      aria-label="Collection name"
      className="w-full bg-transparent text-2xl font-semibold text-fg outline-none placeholder:text-subtle"
    />
  );
}
