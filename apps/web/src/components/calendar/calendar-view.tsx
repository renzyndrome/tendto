/**
 * Unified calendar — a month grid over date-bearing items across every collection AND every
 * workspace you belong to. Items stream from the local replica via a reactive query (instant,
 * offline); a chip opens that item's card, switching workspace if it lives in another one.
 *
 * Clicking a day opens the day view (`/calendar/$date`), where tasks are plotted on a time grid.
 */
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { useDatedItems, type CalendarItem } from "../../lib/calendar-items";
import {
  addMonths,
  formatMonthLabel,
  monthGrid,
  toDateKey,
  WEEKDAYS,
} from "../../lib/calendar";
import { useVisibleWorkspaces } from "../../lib/use-workspaces";
import { useUiStore } from "../../stores/ui";

export function CalendarView() {
  const navigate = useNavigate();
  const setActiveWorkspace = useUiStore((s) => s.setActiveWorkspace);
  const activeWorkspaceId = useUiStore((s) => s.activeWorkspaceId);
  const [viewDate, setViewDate] = useState(() => new Date());

  const workspaces = useVisibleWorkspaces();
  const items = useDatedItems(workspaces);
  // With a single workspace every badge would say the same thing, so there is nothing to tell.
  const showWorkspace = workspaces.length > 1;

  const itemsByDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const key = item.due.slice(0, 10);
      if (!key) continue;
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    // Earliest first, so the three chips a cell has room for are the day's first three. The due
    // format sorts lexicographically (all-day "…-17" before "…-17T09:00"), which is the order
    // the day view uses too.
    for (const list of map.values()) list.sort((a, b) => a.due.localeCompare(b.due));
    return map;
  }, [items]);

  const days = useMemo(() => monthGrid(viewDate), [viewDate]);
  const todayKey = toDateKey(new Date());
  const activeMonth = viewDate.getMonth();

  function openItem(item: CalendarItem): void {
    // The card renders inside its collection, which is workspace-scoped — so follow the item
    // rather than leaving the sidebar pointed somewhere else.
    if (item.workspaceId !== activeWorkspaceId) setActiveWorkspace(item.workspaceId);
    void navigate({
      to: "/c/$collectionId/i/$itemId",
      params: { collectionId: item.collectionId, itemId: item.id },
    });
  }

  function openDay(key: string): void {
    void navigate({ to: "/calendar/$date", params: { date: key } });
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col px-6 py-8">
      <header className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-fg">{formatMonthLabel(viewDate)}</h1>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setViewDate((d) => addMonths(d, -1))}
            aria-label="Previous month"
            className="rounded-md px-2 py-1 text-sm text-muted hover:bg-hover hover:text-fg"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setViewDate(new Date())}
            className="rounded-md px-3 py-1 text-sm text-muted hover:bg-hover hover:text-fg"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setViewDate((d) => addMonths(d, 1))}
            aria-label="Next month"
            className="rounded-md px-2 py-1 text-sm text-muted hover:bg-hover hover:text-fg"
          >
            ›
          </button>
        </div>
      </header>

      <div className="grid grid-cols-7 border-l border-t border-line text-xs">
        {WEEKDAYS.map((weekday) => (
          <div
            key={weekday}
            className="border-b border-r border-line bg-surface px-2 py-1 font-medium text-subtle"
          >
            {weekday}
          </div>
        ))}

        {days.map((day) => {
          const key = toDateKey(day);
          const inMonth = day.getMonth() === activeMonth;
          const isToday = key === todayKey;
          const dayItems = itemsByDate.get(key) ?? [];
          return (
            <div
              key={key}
              data-testid={`cal-day-${key}`}
              onClick={() => openDay(key)}
              className={
                "min-h-[92px] cursor-pointer border-b border-r border-line p-1 hover:bg-hover/40 " +
                (inMonth ? "bg-app" : "bg-surface/40")
              }
            >
              <div className="mb-1 flex justify-end">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openDay(key);
                  }}
                  aria-label={`Open ${key}`}
                  className={
                    "inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-xs hover:bg-hover " +
                    (isToday
                      ? "bg-accent font-medium text-on-accent hover:bg-accent"
                      : inMonth
                        ? "text-muted"
                        : "text-subtle")
                  }
                >
                  {day.getDate()}
                </button>
              </div>
              <div className="space-y-0.5">
                {dayItems.slice(0, 3).map((item) => (
                  <CalendarChip
                    key={item.id}
                    item={item}
                    onOpen={openItem}
                    showWorkspace={showWorkspace}
                  />
                ))}
                {dayItems.length > 3 ? (
                  <span className="block px-1 text-[11px] text-subtle underline-offset-2 hover:underline">
                    +{dayItems.length - 3} more
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CalendarChip({
  item,
  onOpen,
  showWorkspace,
}: {
  item: CalendarItem;
  onOpen: (item: CalendarItem) => void;
  showWorkspace: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation(); // the cell behind opens the day view
        onOpen(item);
      }}
      // A cell is too narrow to always show the workspace, so the tooltip carries it in full.
      title={showWorkspace && item.workspaceName ? `${item.title} — ${item.workspaceName}` : item.title}
      className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] text-muted hover:bg-hover"
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-subtle" aria-hidden />
      <span className="truncate">{item.title}</span>
      {showWorkspace && item.workspaceName ? (
        <span
          data-testid="cal-workspace-badge"
          className="ml-auto max-w-[45%] shrink-0 truncate rounded bg-hover px-1 text-[10px] text-subtle"
        >
          {item.workspaceName}
        </span>
      ) : null}
    </button>
  );
}
