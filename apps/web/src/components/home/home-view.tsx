/**
 * Home — a calm landing surface. Recent pages if any, otherwise a quiet empty state with the two
 * primitives the app is built on: create a page, or jump anywhere (⌘K). No clutter.
 */
import { useQuery } from "@powersync/react";
import { useNavigate } from "@tanstack/react-router";

import { createPage } from "../../lib/pages";
import { useUiStore } from "../../stores/ui";
import { Icon } from "../ui/icon";
import { Kbd } from "../ui/kbd";
import { TopBar } from "../layout/top-bar";

interface RecentPage {
  id: string;
  title: string;
  updated_at: string;
}

export function HomeView() {
  const navigate = useNavigate();
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);

  const { data: recent } = useQuery<RecentPage>(
    "SELECT id, title, updated_at FROM pages WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 6",
    [workspaceId ?? ""],
  );

  async function handleNewPage(): Promise<void> {
    if (!workspaceId) return;
    const id = await createPage(workspaceId, null);
    void navigate({ to: "/p/$pageId", params: { pageId: id } });
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar crumbs={[{ label: "Home" }]} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-doc px-6 py-12 md:py-16">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-[13px] bg-accent text-xl font-bold text-accent-contrast">
              T
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-[-0.01em] text-ink">Welcome back</h1>
              <p className="text-[13px] text-muted">Instant like Obsidian, synced like Notion.</p>
            </div>
          </div>

          <div className="mb-10 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleNewPage()}
              className="flex items-center gap-2 rounded-input bg-accent px-4 py-2 text-[13.5px] font-medium text-accent-contrast hover:bg-accent-hover"
            >
              <Icon name="plus" size={16} />
              Create page
            </button>
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 rounded-input border border-border-soft bg-surface px-4 py-2 text-[13.5px] text-secondary hover:border-border-hover"
            >
              <Icon name="search" size={16} className="text-muted" />
              Jump anywhere
              <Kbd className="ml-1">⌘K</Kbd>
            </button>
          </div>

          {recent.length > 0 ? (
            <div>
              <h2 className="mb-2 text-section-label uppercase text-faint">Recent</h2>
              <div className="overflow-hidden rounded-card border border-hairline bg-surface">
                {recent.map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    onClick={() =>
                      void navigate({ to: "/p/$pageId", params: { pageId: page.id } })
                    }
                    className="flex w-full items-center gap-2.5 border-b border-hairline px-4 py-2.5 text-left last:border-b-0 hover:bg-row-hover"
                  >
                    <Icon name="page" size={15} className="shrink-0 text-faint" />
                    <span className="truncate text-[13.5px] text-body">
                      {page.title || "Untitled"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[13.5px] text-muted">
              Your notes live on this device first. Create a page to begin — it saves instantly and
              syncs quietly in the background.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
