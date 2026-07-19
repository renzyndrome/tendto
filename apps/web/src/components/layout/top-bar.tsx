/**
 * TopBar — the breadcrumb + right-side actions strip above a document or board (Meadow spec).
 * On mobile it collapses: a menu button opens the sidebar drawer and the breadcrumb trims to the
 * current page. Actions are passed by the route (e.g. "Edited 2m ago", Share, ⋯).
 */
import type { ReactNode } from "react";

import { useUiStore } from "../../stores/ui";
import { Icon } from "../ui/icon";

export interface Crumb {
  label: string;
  onClick?: () => void;
}

interface TopBarProps {
  crumbs: Crumb[];
  right?: ReactNode;
}

export function TopBar({ crumbs, right }: TopBarProps) {
  const openSidebar = useUiStore((s) => s.setSidebarOpen);

  return (
    <div className="flex items-center gap-2.5 border-b border-hairline px-4 py-3 md:px-6">
      <button
        type="button"
        onClick={() => openSidebar(true)}
        aria-label="Open sidebar"
        className="-ml-1 flex h-9 w-9 items-center justify-center rounded-row text-muted hover:bg-row-hover hover:text-ink md:hidden"
      >
        <Icon name="sidebar" size={18} />
      </button>

      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2.5">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <span key={index} className="flex min-w-0 items-center gap-2.5">
              {index > 0 ? <span className="text-[11px] text-chevron">/</span> : null}
              {crumb.onClick && !last ? (
                <button
                  type="button"
                  onClick={crumb.onClick}
                  className="truncate text-[12.5px] text-muted hover:text-ink"
                >
                  {crumb.label}
                </button>
              ) : (
                <span
                  className={
                    "truncate text-[12.5px] " + (last ? "font-medium text-ink" : "text-muted")
                  }
                >
                  {crumb.label}
                </span>
              )}
            </span>
          );
        })}
      </nav>

      {right ? <div className="ml-auto flex items-center gap-3.5">{right}</div> : null}
    </div>
  );
}

/** Standard right-side actions: an optional meta note + a Share button that opens the share modal. */
export function TopBarActions({ meta }: { meta?: string }) {
  const setShareOpen = useUiStore((s) => s.setShareOpen);
  return (
    <>
      {meta ? <span className="hidden text-meta text-faint sm:inline">{meta}</span> : null}
      <button
        type="button"
        onClick={() => setShareOpen(true)}
        className="flex items-center gap-1.5 rounded-row border border-hairline-strong px-3 py-[5px] text-[12.5px] text-secondary hover:bg-btn-hover"
      >
        <Icon name="share" size={13} />
        Share
      </button>
    </>
  );
}
