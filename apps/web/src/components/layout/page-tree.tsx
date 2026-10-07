/**
 * The sidebar's Pages section: folders, pages and subpages in one tree (see sidebar-tree.tsx for
 * how the tree behaves). A folder is a pages row with `kind = 'folder'`; lib/pages.ts writes.
 */
import { useQuery } from "@powersync/react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

import { useSession } from "../../lib/auth/client";
import {
  addFavorite,
  removeFavorite,
  removeFavoritesFor,
  useFavoriteIds,
} from "../../lib/favorites";
import {
  AUTO_TITLE,
  createFolder,
  createPage,
  deletePages,
  movePage,
  placePage,
  renamePage,
} from "../../lib/pages";
import type { TreeRow } from "../../lib/tree";
import { idFromPath, SidebarTree } from "./sidebar-tree";
import { NewPageIcon } from "./tree-icons";

export function PageTree({ workspaceId }: { workspaceId: string | null }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { data: session } = useSession();
  const favoriteIds = useFavoriteIds();
  const { data: rows } = useQuery<TreeRow>(
    // created_at breaks position ties (rows moved on two devices at once) the same way everywhere.
    "SELECT id, title, parent_id, kind, position FROM pages WHERE workspace_id = ? ORDER BY created_at",
    [workspaceId ?? ""],
  );

  return (
    <SidebarTree
      source={{
        heading: "Pages",
        testId: "page-tree",
        emptyText: "No pages yet",
        untitled: AUTO_TITLE,
        itemKind: "page",
        dragType: "application/x-tendto-page",
        newItemLabel: "New page",
        newItemIcon: <NewPageIcon />,
        addToFolderLabel: "Add page to folder",
        addInsideItemLabel: "Add subpage",
        deleteItemLabel: "Delete page",
        enabled: workspaceId !== null,
        rows,
        openId: idFromPath(pathname, "p"),
        open: (id) => void navigate({ to: "/p/$pageId", params: { pageId: id } }),
        createItem: (parentId) => createPage(workspaceId ?? "", parentId),
        createFolder: (parentId, name) => createFolder(workspaceId ?? "", parentId, name),
        rename: renamePage,
        move: movePage,
        place: placePage,
        remove: async (ids) => {
          await deletePages(ids);
          await removeFavoritesFor(ids);
        },
        afterDelete: () => void navigate({ to: "/" }),
        favoriteIds,
        toggleFavorite: (row: TreeRow) =>
          void (favoriteIds.has(row.id)
            ? removeFavorite(row.id)
            : addFavorite(session?.user?.id ?? null, "page", row.id)),
      }}
    />
  );
}
