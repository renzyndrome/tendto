/**
 * Day view — one day as a time grid, Google Calendar style: an all-day row on top, 24 hour rows
 * below, a "now" line when you're looking at today, click an empty slot to plot a task there, and
 * drag a task to move it.
 *
 * The one honest difference from Google: an item is a DEADLINE, not a meeting. It has a due
 * moment and no duration (see lib/items/due.ts), so a block is drawn one slot tall as an anchor
 * rather than as a claim about how long the work takes. Dropping a task on the all-day row
 * clears its time, which is exactly what "all day" means here — due that day, whenever.
 *
 * Everything streams from the local replica through reactive queries, so this is instant and
 * works offline like every other view.
 */
import { useQuery } from "@powersync/react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import {
  addDays,
  formatDayLabel,
  formatHourLabel,
  HOURS,
  layoutByTime,
  MINUTES_PER_DAY,
  minutesToTime,
  parseDateKey,
  SLOT_MINUTES,
  snapToSlot,
  timeToMinutes,
  toDateKey,
} from "../../lib/calendar";
import { formatDue, parseDue } from "../../lib/items/due";
import {
  createItem,
  parseProperties,
  patchItem,
  type ItemRow,
} from "../../lib/items/mutations";
import { useUiStore } from "../../stores/ui";

const HOUR_HEIGHT = 56;
const PX_PER_MINUTE = HOUR_HEIGHT / 60;
/** Where the grid scrolls to when the day isn't today — the working day, not midnight. */
const DEFAULT_SCROLL_HOUR = 7;

interface DayItem {
  row: ItemRow;
  id: string;
  collectionId: string;
  title: string;
  minutes: number; // -1 for all-day
}

interface Draft {
  minutes: number;
  allDay: boolean;
}

export function DayView({ dateKey }: { dateKey: string }) {
  const navigate = useNavigate();
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);
  const day = useMemo(() => parseDateKey(dateKey) ?? new Date(), [dateKey]);
  const isToday = toDateKey(day) === toDateKey(new Date());

  const { data: rows } = useQuery<ItemRow>(
    "SELECT * FROM items WHERE workspace_id = ? AND json_extract(properties, '$.due') LIKE ?",
    [workspaceId ?? "", `${dateKey}%`],
  );

  const { allDay, timed } = useMemo(() => {
    const all: DayItem[] = [];
    const slotted: DayItem[] = [];
    for (const row of rows) {
      const props = parseProperties(row);
      const { date, time } = parseDue(props.due);
      if (date !== dateKey) continue; // LIKE is a prefix match; be exact about the day
      const item: DayItem = {
        row,
        id: row.id,
        collectionId: row.collection_id,
        title: props.title || "Untitled",
        minutes: time ? timeToMinutes(time) : -1,
      };
      (item.minutes < 0 ? all : slotted).push(item);
    }
    return { allDay: all, timed: layoutByTime(slotted) };
  }, [rows, dateKey]);

  const [draft, setDraft] = useState<Draft | null>(null);

  function goToDay(delta: number): void {
    setDraft(null);
    void navigate({ to: "/calendar/$date", params: { date: toDateKey(addDays(day, delta)) } });
  }

  function openItem(item: DayItem): void {
    void navigate({
      to: "/c/$collectionId/i/$itemId",
      params: { collectionId: item.collectionId, itemId: item.id },
    });
  }

  /** Move an item to a new time on this day — or to all-day, which clears the time. */
  function reschedule(item: DayItem, minutes: number | null): void {
    const time = minutes === null ? "" : minutesToTime(minutes);
    void patchItem(item.row, { due: formatDue(dateKey, time) });
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col px-6 py-8">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-fg">{formatDayLabel(day)}</h1>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => goToDay(-1)}
            aria-label="Previous day"
            className="rounded-md px-2 py-1 text-sm text-muted hover:bg-hover hover:text-fg"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(null);
              void navigate({
                to: "/calendar/$date",
                params: { date: toDateKey(new Date()) },
              });
            }}
            className="rounded-md px-3 py-1 text-sm text-muted hover:bg-hover hover:text-fg"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => goToDay(1)}
            aria-label="Next day"
            className="rounded-md px-2 py-1 text-sm text-muted hover:bg-hover hover:text-fg"
          >
            ›
          </button>
          <button
            type="button"
            onClick={() => void navigate({ to: "/calendar" })}
            className="ml-2 rounded-md border border-line px-3 py-1 text-sm text-muted hover:bg-hover hover:text-fg"
          >
            Month
          </button>
        </div>
      </header>

      <AllDayRow
        items={allDay}
        onOpen={openItem}
        onDropItem={(id) => {
          const item = timed.find((entry) => entry.id === id);
          if (item) reschedule(item, null);
        }}
        onAdd={() => setDraft((current) => (current?.allDay ? null : { minutes: -1, allDay: true }))}
      />

      {draft?.allDay ? (
        <QuickCreate
          dateKey={dateKey}
          minutes={-1}
          onClose={() => setDraft(null)}
          className="mt-2 max-w-sm"
        />
      ) : null}

      {/* Only while the day is genuinely empty — the grid gives no other hint that it's clickable. */}
      {allDay.length === 0 && timed.length === 0 && !draft ? (
        <p className="mt-2 text-xs text-subtle">Click a slot to plot a task at that time.</p>
      ) : null}

      <TimeGrid
        dateKey={dateKey}
        isToday={isToday}
        items={timed}
        draft={draft}
        onOpen={openItem}
        onPickSlot={(minutes) => setDraft({ minutes, allDay: false })}
        onMoveItem={(id, minutes) => {
          const item = [...timed, ...allDay].find((entry) => entry.id === id);
          if (item) reschedule(item, minutes);
        }}
        onCloseDraft={() => setDraft(null)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ all-day row */

function AllDayRow({
  items,
  onOpen,
  onDropItem,
  onAdd,
}: {
  items: DayItem[];
  onOpen: (item: DayItem) => void;
  onDropItem: (id: string) => void;
  onAdd: () => void;
}) {
  const [over, setOver] = useState(false);

  return (
    <div className="flex items-stretch border border-line bg-app text-xs">
      <div className="w-16 shrink-0 border-r border-line px-2 py-2 text-right text-subtle">
        All day
      </div>
      <div
        data-testid="day-all-day"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          const id = event.dataTransfer.getData("text/plain");
          if (id) onDropItem(id);
        }}
        onClick={onAdd}
        className={
          "flex min-h-[2.5rem] flex-1 flex-wrap content-start gap-1 p-1.5 " +
          (over ? "bg-accent/10" : "")
        }
      >
        {items.map((item) => (
          <DayChip key={item.id} item={item} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ time grid */

function TimeGrid({
  dateKey,
  isToday,
  items,
  draft,
  onOpen,
  onPickSlot,
  onMoveItem,
  onCloseDraft,
}: {
  dateKey: string;
  isToday: boolean;
  items: Array<DayItem & { lane: number; lanes: number }>;
  draft: Draft | null;
  onOpen: (item: DayItem) => void;
  onPickSlot: (minutes: number) => void;
  onMoveItem: (id: string, minutes: number) => void;
  onCloseDraft: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  /** Where inside the dragged chip the pointer grabbed it, so a drop preserves the grip. */
  const grabOffset = useRef(0);
  const nowMinutes = useNowMinutes(isToday);

  // Open where the day actually is, like Google: at "now" for today, at the working day otherwise.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const target = isToday
      ? minutesSinceMidnight(new Date()) - 60
      : DEFAULT_SCROLL_HOUR * 60;
    container.scrollTop = Math.max(0, target * PX_PER_MINUTE);
  }, [dateKey, isToday]);

  /** Snap a pointer position inside the grid to a slot. */
  function slotFromEvent(clientY: number, offset = 0): number {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return snapToSlot((clientY - rect.top - offset) / PX_PER_MINUTE);
  }

  return (
    <div ref={scrollRef} className="mt-2 flex-1 overflow-y-auto border border-line bg-app">
      <div className="flex">
        <div className="w-16 shrink-0 border-r border-line">
          {HOURS.map((hour) => (
            <div
              key={hour}
              style={{ height: HOUR_HEIGHT }}
              className="relative pr-2 text-right text-[11px] text-subtle"
            >
              {hour > 0 ? <span className="absolute right-2 -top-1.5">{formatHourLabel(hour)}</span> : null}
            </div>
          ))}
        </div>

        <div
          ref={gridRef}
          data-testid="day-grid"
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            onPickSlot(slotFromEvent(event.clientY));
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            event.preventDefault();
            const id = event.dataTransfer.getData("text/plain");
            if (id) onMoveItem(id, slotFromEvent(event.clientY, grabOffset.current));
          }}
          className="relative flex-1 cursor-pointer"
          style={{ height: MINUTES_PER_DAY * PX_PER_MINUTE }}
        >
          {HOURS.map((hour) => (
            <div
              key={hour}
              aria-hidden
              className="pointer-events-none absolute inset-x-0 border-t border-line/70"
              style={{ top: hour * HOUR_HEIGHT }}
            />
          ))}

          {nowMinutes !== null ? (
            <div
              data-testid="day-now"
              aria-hidden
              className="pointer-events-none absolute inset-x-0 z-20 border-t border-rose-500"
              style={{ top: nowMinutes * PX_PER_MINUTE }}
            >
              <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-rose-500" />
            </div>
          ) : null}

          {items.map((item) => (
            <DayBlock
              key={item.id}
              item={item}
              onOpen={onOpen}
              onGrab={(offset) => {
                grabOffset.current = offset;
              }}
            />
          ))}

          {draft && !draft.allDay ? (
            <QuickCreate
              dateKey={dateKey}
              minutes={draft.minutes}
              onClose={onCloseDraft}
              className="absolute left-2 right-2 max-w-sm"
              style={{
                top: draft.minutes * PX_PER_MINUTE,
                // Flip above the slot late in the day so the form doesn't hang off the grid.
                transform: draft.minutes > MINUTES_PER_DAY - 180 ? "translateY(-100%)" : undefined,
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DayBlock({
  item,
  onOpen,
  onGrab,
}: {
  item: DayItem & { lane: number; lanes: number };
  onOpen: (item: DayItem) => void;
  onGrab: (offset: number) => void;
}) {
  const width = 100 / item.lanes;
  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => {
        // The id travels on the drag itself (not in component state) so both drop targets — the
        // grid and the all-day row — can read it without either knowing what's being dragged.
        event.dataTransfer.setData("text/plain", item.id);
        event.dataTransfer.effectAllowed = "move";
        onGrab(event.nativeEvent.offsetY);
      }}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(item);
      }}
      title={item.title}
      data-testid={`day-item-${item.id}`}
      style={{
        top: item.minutes * PX_PER_MINUTE,
        height: SLOT_MINUTES * PX_PER_MINUTE - 2,
        left: `calc(${item.lane * width}% + 0.25rem)`,
        width: `calc(${width}% - 0.5rem)`,
      }}
      className="absolute z-10 flex items-center gap-1.5 overflow-hidden rounded-md border border-line bg-surface pl-3 pr-2 text-left text-xs text-fg shadow-sm hover:bg-hover"
    >
      {/* The rail is what stops a short, full-width block reading as a divider line. */}
      <span className="absolute inset-y-0 left-0 w-1 rounded-l bg-accent" aria-hidden />
      <span className="shrink-0 tabular-nums text-[11px] text-muted">
        {minutesToTime(item.minutes)}
      </span>
      <span className="truncate">{item.title}</span>
    </button>
  );
}

function DayChip({ item, onOpen }: { item: DayItem; onOpen: (item: DayItem) => void }) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", item.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(item);
      }}
      title={item.title}
      data-testid={`day-item-${item.id}`}
      className="max-w-full truncate rounded border border-line bg-surface px-2 py-0.5 text-xs text-fg hover:bg-hover"
    >
      {item.title}
    </button>
  );
}

/* ------------------------------------------------------------------ quick create */

/**
 * The bubble Google pops when you click an empty slot: type a title, pick which collection it
 * lands in, Enter to save. The collection picker is the one thing Google doesn't need and we do —
 * an item has to belong to a collection, so guessing silently would drop tasks into the wrong one.
 */
function QuickCreate({
  dateKey,
  minutes,
  onClose,
  className,
  style,
}: {
  dateKey: string;
  minutes: number;
  onClose: () => void;
  className: string;
  style?: CSSProperties;
}) {
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);
  const { data: collections } = useQuery<{ id: string; name: string }>(
    "SELECT id, name FROM collections WHERE workspace_id = ? ORDER BY created_at",
    [workspaceId ?? ""],
  );

  const [title, setTitle] = useState("");
  const [time, setTime] = useState(minutes < 0 ? "" : minutesToTime(minutes));
  const [picked, setPicked] = useState("");
  const [saving, setSaving] = useState(false);
  const collectionId = picked || collections[0]?.id || "";

  async function save(): Promise<void> {
    if (!workspaceId || !collectionId || !title.trim() || saving) return;
    setSaving(true);
    await createItem(workspaceId, collectionId, {
      title: title.trim(),
      due: formatDue(dateKey, time),
    });
    onClose();
  }

  const body =
    collections.length === 0 ? (
      <p className="text-xs text-muted">
        Create a collection first — tasks live in one, so there's nowhere to put this yet.
      </p>
    ) : (
      <>
        <input
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a task"
          aria-label="Task title"
          data-testid="quick-create-title"
          className="w-full rounded-lg border border-line bg-app px-2.5 py-1.5 text-sm text-fg outline-none transition-shadow focus:border-muted/60"
        />
        <div className="flex items-center gap-2">
          <input
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            aria-label="Time (optional)"
            data-testid="quick-create-time"
            className="rounded-lg border border-line bg-app px-2.5 py-1.5 text-xs text-muted outline-none focus:border-muted/60"
          />
          <select
            value={collectionId}
            onChange={(event) => setPicked(event.target.value)}
            aria-label="Collection"
            data-testid="quick-create-collection"
            className="min-w-0 flex-1 rounded-lg border border-line bg-app px-2.5 py-1.5 text-xs text-muted outline-none focus:border-muted/60"
          >
            {collections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2.5 py-1 text-xs text-muted hover:bg-hover hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim() || saving}
            className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-on-accent disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </>
    );

  return (
    <form
      data-testid="quick-create"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
      style={style}
      className={`z-30 space-y-2 rounded-xl border border-line bg-surface p-3 shadow-lg ${className}`}
    >
      {body}
    </form>
  );
}

/* ------------------------------------------------------------------ now line */

function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** Minutes since midnight, ticking each minute — null when this isn't today. */
function useNowMinutes(isToday: boolean): number | null {
  const [now, setNow] = useState(() => minutesSinceMidnight(new Date()));

  useEffect(() => {
    if (!isToday) return;
    const id = setInterval(() => setNow(minutesSinceMidnight(new Date())), 60_000);
    return () => clearInterval(id);
  }, [isToday]);

  return isToday ? now : null;
}
