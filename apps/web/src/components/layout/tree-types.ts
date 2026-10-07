/**
 * Types shared by the sidebar tree's pieces (sidebar-tree.tsx, tree-row.tsx, tree-menu.tsx).
 * Kept apart so the row and the menu can import them without importing the tree itself.
 */
import type { DragEvent, MouseEvent, ReactNode } from "react";

import type { Tree, TreeRow } from "../../lib/tree";

/** What one section's tree is made of, and how to change it. */
export interface TreeSource {
  /** Section heading, also the section's accessible name ("Pages"). */
  heading: string;
  /** Test id of the tree body, which is also the top-level drop target. */
  testId: string;
  emptyText: string;
  /** Fallback name for a row with an empty title. */
  untitled: string;
  /** `data-kind` of a non-folder row ("page", "collection"). */
  itemKind: string;
  /**
   * The drag payload's type, one per section so a row never drops into the other tree.
   * Deliberately not text/plain: the editor and title fields accept dropped text, so a row let
   * go over the page would paste its id into the document.
   */
  dragType: string;
  newItemLabel: string;
  newItemIcon: ReactNode;
  /** Hover "+" on a folder row. */
  addToFolderLabel: string;
  /** Hover "+" on an item row, when items can hold items (subpages). Omitted otherwise. */
  addInsideItemLabel?: string;
  deleteItemLabel: string;
  /** Longest name the server column accepts, when it has a limit. */
  maxNameLength?: number;
  /** False until there is a workspace to write into. */
  enabled: boolean;
  rows: readonly TreeRow[];
  /** The page or collection the route has open, highlighted without being clicked. */
  openId: string | null;
  open: (id: string) => void;
  /** Create an item and return its id; the tree highlights and opens it. */
  createItem: (parentId: string | null) => Promise<string>;
  createFolder: (parentId: string | null, name: string) => Promise<string>;
  rename: (id: string, name: string) => Promise<void>;
  /** Move under a parent, last. */
  move: (id: string, parentId: string | null) => Promise<boolean>;
  /** Move under a parent at an exact spot: `orderedIds` is the new order of its siblings. */
  place: (id: string, parentId: string | null, orderedIds: readonly string[]) => Promise<boolean>;
  /** Delete exactly these rows (the deleted row and what the tree shows inside it). */
  remove: (ids: readonly string[]) => Promise<void>;
  /** Leave the open row once it is deleted. */
  afterDelete: () => void;
  favoriteIds: ReadonlySet<string>;
  toggleFavorite: (row: TreeRow) => void;
}

/**
 * Where a drag would land. `parentId` is the parent it joins (null = top level). The rest says
 * what to light: a folder for a drop into it, or a line above or below a row for a reorder, in
 * which case `order` is the sibling order to write.
 */
export interface DropHint {
  parentId: string | null;
  intoId?: string;
  lineId?: string;
  linePlace?: "before" | "after";
  order?: string[];
}

/** Everything a row needs from the tree, passed down as one object. */
export interface TreeContext {
  source: TreeSource;
  tree: Tree;
  selectedId: string | null;
  collapsed: ReadonlySet<string>;
  renamingId: string | null;
  /** The parent a new folder is being named in; undefined when none is. */
  draftParent: string | null | undefined;
  drop: DropHint | undefined;
  draggingId: string | null;
  onToggle: (id: string) => void;
  onSelect: (row: TreeRow) => void;
  onStartRename: (id: string) => void;
  /** `byKey`: committed with Enter, so focus goes back to the row. */
  onRename: (id: string, name: string, byKey: boolean) => void;
  onCancelRename: () => void;
  onCommitDraft: (name: string, byKey: boolean) => void;
  onCancelDraft: () => void;
  onAddInside: (parentId: string) => void;
  onDelete: (row: TreeRow) => void;
  onContextMenu: (event: MouseEvent, row: TreeRow) => void;
  onDragStart: (event: DragEvent, id: string) => void;
  onRowDragOver: (event: DragEvent, row: TreeRow) => void;
  onRowDrop: (event: DragEvent, row: TreeRow) => void;
  onDragEnd: () => void;
}
