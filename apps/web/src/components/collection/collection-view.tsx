/**
 * CollectionView — one collection rendered as one of four projections of the SAME items:
 * checklist · list · table · board (kanban). Switching a view is pure rendering; it never
 * migrates data. Items stream from the local replica via a reactive query, so edits from any
 * view (or a synced-down change) re-render instantly.
 */
import { useQuery } from "@powersync/react";
import { useEffect, useMemo, useState } from "react";

import { createItem, parseColumns, type ItemRow } from "../../lib/items/mutations";
import { db } from "../../lib/powersync/client";
import { useWorkspaceMembers } from "../../stores/members";
import { useUiStore } from "../../stores/ui";
import { TopBar } from "../layout/top-bar";
import { SegmentedControl, type SegmentOption } from "../ui/segmented";
import { Spinner } from "../ui/spinner";
import { TaskDetailModal } from "./task-detail-modal";
import { BoardView } from "./views/board-view";
import { ChecklistView } from "./views/checklist-view";
import { ListView } from "./views/list-view";
import { TableView } from "./views/table-view";

const VIEWS = ["checklist", "list", "table", "board"] as const;
export type CollectionViewKind = (typeof VIEWS)[number];

// Segmented view switcher — Meadow order is Board first, then Table / List / Checklist.
const VIEW_OPTIONS: SegmentOption<CollectionViewKind>[] = [
  { value: "board", label: "Board" },
  { value: "table", label: "Table" },
  { value: "list", label: "List" },
  { value: "checklist", label: "Checklist" },
];

interface CollectionRow {
  id: string;
  name: string;
  default_view: string;
  config: string;
}

function isViewKind(value: string | undefined): value is CollectionViewKind {
  return value === "checklist" || value === "list" || value === "table" || value === "board";
}

export function CollectionView({ collectionId }: { collectionId: string }) {
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);

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
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const members = useWorkspaceMembers(workspaceId);
  const columns = useMemo(() => parseColumns(collection?.config), [collection?.config]);
  const openRow = openItemId ? items.find((i) => i.id === openItemId) ?? null : null;
  const view: CollectionViewKind =
    override ?? (isViewKind(collection?.default_view) ? collection.default_view : "board");

  if (isLoading && !collection) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas">
        <Spinner label="Loading…" />
      </div>
    );
  }
  if (!collection) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas">
        <p className="text-sm text-muted">This collection no longer exists.</p>
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

  async function handleNewItem(): Promise<void> {
    if (!workspaceId) return;
    await createItem(workspaceId, collectionId, { title: "", status: columns[0]?.id });
  }

  return (
    <div className="flex h-full flex-col bg-canvas">
      <TopBar crumbs={[{ label: "Pages" }, { label: collection.name || "Untitled" }]} />

      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-6 pt-6">
        <CollectionName collectionId={collectionId} name={collection.name} />

        <div className="mb-4 mt-3.5 flex items-center gap-3">
          <SegmentedControl
            options={VIEW_OPTIONS}
            value={view}
            onChange={(next) => void switchView(next)}
            ariaLabel="Collection view"
          />
          <button
            type="button"
            onClick={() => void handleNewItem()}
            className="ml-auto shrink-0 rounded-input bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-accent-contrast hover:bg-accent-hover"
          >
            + New item
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto pb-8">
          {view === "checklist" ? (
            <ChecklistView items={items} columns={columns} />
          ) : view === "list" ? (
            <ListView items={items} columns={columns} members={members} onOpenItem={setOpenItemId} />
          ) : view === "table" ? (
            <TableView items={items} columns={columns} members={members} onOpenItem={setOpenItemId} />
          ) : (
            <BoardView
              items={items}
              workspaceId={workspaceId}
              collectionId={collectionId}
              columns={columns}
              members={members}
              onOpenItem={setOpenItemId}
            />
          )}
        </div>
      </div>

      {openRow ? (
        <TaskDetailModal
          key={openRow.id}
          row={openRow}
          columns={columns}
          members={members}
          onClose={() => setOpenItemId(null)}
        />
      ) : null}
    </div>
  );
}

/** Inline-editable collection name (commits on blur / Enter). */
function CollectionName({ collectionId, name }: { collectionId: string; name: string }) {
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);

  async function commit(): Promise<void> {
    // Save the trimmed value as-is (empty is allowed); the sidebar/breadcrumb display "Untitled"
    // via `name || "Untitled"`, so an unnamed collection shows a placeholder rather than literal text.
    const trimmed = value.trim();
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
      className="w-full bg-transparent text-[28px] font-bold tracking-[-0.02em] text-ink outline-none placeholder:text-muted"
    />
  );
}
