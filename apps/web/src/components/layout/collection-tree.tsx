/**
 * The sidebar's Collections section: folders and collections in one tree, the same explorer as
 * Pages (see sidebar-tree.tsx). A folder is a collections row with `kind = 'folder'`; a
 * collection cannot hold another collection, so only folders nest. lib/collections.ts writes.
 *
 * Rows from before migration 0011 have no `position` and sort as 0, in creation order, which
 * is what the old flat list showed; a drag writes real positions.
 */
import { useQuery } from "@powersync/react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

import { useSession } from "../../lib/auth/client";
import {
  COLLECTION_NAME_MAX,
  createCollection,
  createCollectionFolder,
  deleteCollections,
  moveCollection,
  placeCollection,
  renameCollection,
} from "../../lib/collections";
import {
  addFavorite,
  removeFavorite,
  removeFavoritesFor,
  useFavoriteIds,
} from "../../lib/favorites";
import type { TreeRow } from "../../lib/tree";
import { idFromPath, SidebarTree } from "./sidebar-tree";
import { NewCollectionIcon } from "./tree-icons";

const UNTITLED = "Untitled";

export function CollectionTree({ workspaceId }: { workspaceId: string | null }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { data: session } = useSession();
  const favoriteIds = useFavoriteIds();
  const { data: rows } = useQuery<TreeRow>(
    `SELECT id, name AS title, parent_id, kind, coalesce(position, 0) AS position
       FROM collections WHERE workspace_id = ? ORDER BY created_at`,
    [workspaceId ?? ""],
  );

  return (
    <SidebarTree
      source={{
        heading: "Collections",
        testId: "collection-tree",
        emptyText: "No collections yet",
        untitled: UNTITLED,
        itemKind: "collection",
        dragType: "application/x-tendto-collection",
        newItemLabel: "New collection",
        newItemIcon: <NewCollectionIcon />,
        addToFolderLabel: "Add collection to folder",
        deleteItemLabel: "Delete collection",
        maxNameLength: COLLECTION_NAME_MAX,
        enabled: workspaceId !== null,
        rows,
        // Also matches /c/<id>/i/<item>: an open card keeps its collection highlighted.
        openId: idFromPath(pathname, "c"),
        open: (id) => void navigate({ to: "/c/$collectionId", params: { collectionId: id } }),
        createItem: (parentId) => createCollection(workspaceId ?? "", parentId),
        createFolder: (parentId, name) => createCollectionFolder(workspaceId ?? "", parentId, name),
        rename: renameCollection,
        move: moveCollection,
        place: placeCollection,
        remove: async (ids) => {
          await deleteCollections(ids);
          await removeFavoritesFor(ids);
        },
        afterDelete: () => void navigate({ to: "/" }),
        favoriteIds,
        toggleFavorite: (row: TreeRow) =>
          void (favoriteIds.has(row.id)
            ? removeFavorite(row.id)
            : addFavorite(session?.user?.id ?? null, "collection", row.id)),
      }}
    />
  );
}
