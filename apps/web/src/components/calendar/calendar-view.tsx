/**
 * Unified calendar — a month grid over date-bearing items across ALL collections in the active
 * workspace. Items stream from the local replica via a reactive query (instant, offline); a chip
 * links back to its collection. The `due` filter uses SQLite's json_extract (bundled in
 * PowerSync's SQLite); the JS bucketing also ignores items without a `due`, so it is robust
 * either way.
 */
import { useQuery } from "@powersync/react";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  addMonths,
  formatMonthLabel,
  monthGrid,
  toDateKey,
  WEEKDAYS,
} from "../../lib/calendar";
import { parseProperties, type ItemRow } from "../../lib/items/mutations";
import { useUiStore } from "../../stores/ui";

interface CalendarItem {
  id: string;
  collectionId: string;
  title: string;
}

export function CalendarView() {
  const navigate = useNavigate();
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);
  const [viewDate, setViewDate] = useState(() => new Date());

  const { data: items } = useQuery<ItemRow>(
    "SELECT * FROM items WHERE workspace_id = ? " +
      "AND json_extract(properties, '$.due') IS NOT NULL " +
      "AND json_extract(properties, '$.due') != ''",
    [workspaceId ?? ""],
  );

  const itemsByDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const row of items) {
      const props = parseProperties(row);
      const due = typeof props.due === "string" ? props.due.slice(0, 10) : "";
      if (!due) continue;
      const list = map.get(due) ?? [];
      list.push({
        id: row.id,
        collectionId: row.collection_id,
        title: props.title || "Untitled",
      });
      map.set(due, list);
    }
    return map;
  }, [items]);

  const days = useMemo(() => monthGrid(viewDate), [viewDate]);
  const todayKey = toDateKey(new Date());
  const activeMonth = viewDate.getMonth();

  function openCollection(collectionId: string): void {
    void navigate({ to: "/c/$collectionId", params: { collectionId } });
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col px-6 py-8">
      <header className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-neutral-900">{formatMonthLabel(viewDate)}</h1>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setViewDate((d) => addMonths(d, -1))}
            aria-label="Previous month"
            className="rounded-md px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setViewDate(new Date())}
            className="rounded-md px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setViewDate((d) => addMonths(d, 1))}
            aria-label="Next month"
            className="rounded-md px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
          >
            ›
          </button>
        </div>
      </header>

      <div className="grid grid-cols-7 border-l border-t border-neutral-200 text-xs">
        {WEEKDAYS.map((weekday) => (
          <div
            key={weekday}
            className="border-b border-r border-neutral-200 bg-neutral-50 px-2 py-1 font-medium text-neutral-400"
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
              className={
                "min-h-[92px] border-b border-r border-neutral-200 p-1 " +
                (inMonth ? "bg-white" : "bg-neutral-50/40")
              }
            >
              <div className="mb-1 flex justify-end">
                <span
                  className={
                    "inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-xs " +
                    (isToday
                      ? "bg-neutral-900 font-medium text-white"
                      : inMonth
                        ? "text-neutral-500"
                        : "text-neutral-300")
                  }
                >
                  {day.getDate()}
                </span>
              </div>
              <div className="space-y-0.5">
                {dayItems.slice(0, 3).map((item) => (
                  <CalendarChip key={item.id} item={item} onOpen={openCollection} />
                ))}
                {dayItems.length > 3 ? (
                  <div className="px-1 text-[11px] text-neutral-400">
                    +{dayItems.length - 3} more
                  </div>
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
}: {
  item: CalendarItem;
  onOpen: (collectionId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item.collectionId)}
      title={item.title}
      className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] text-neutral-700 hover:bg-neutral-100"
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-neutral-400" aria-hidden />
      <span className="truncate">{item.title}</span>
    </button>
  );
}
