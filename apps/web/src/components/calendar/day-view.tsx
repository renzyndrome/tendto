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
import { useDatedItems, type CalendarItem } from "../../lib/calendar-items";
import { formatDue, parseDue } from "../../lib/items/due";
import { createItem, patchItem } from "../../lib/items/mutations";
import { useVisibleWorkspaces, type WorkspaceRow } from "../../lib/use-workspaces";
import { useUiStore } from "../../stores/ui";

const HOUR_HEIGHT = 56;
const PX_PER_MINUTE = HOUR_HEIGHT / 60;
/** Where the grid scrolls to when the day isn't today — the working day, not midnight. */
const DEFAULT_SCROLL_HOUR = 7;

/** A calendar item placed on this day: `minutes` since midnight, or -1 for all-day. */
type DayItem = CalendarItem & { minutes: number };

interface Draft {
  minutes: number;
  allDay: boolean;
}

export function DayView({ dateKey }: { dateKey: string }) {
  const navigate = useNavigate();
  const setActiveWorkspace = useUiStore((s) => s.setActiveWorkspace);
  const activeWorkspaceId = useUiStore((s) => s.activeWorkspaceId);
  const day = useMemo(() => parseDateKey(dateKey) ?? new Date(), [dateKey]);
  const isToday = toDateKey(day) === toDateKey(new Date());

  const workspaces = useVisibleWorkspaces();
  const items = useDatedItems(workspaces, dateKey);
  // With a single workspace every badge would say the same thing, so there is nothing to tell.
  const showWorkspace = workspaces.length > 1;

  const { allDay, timed } = useMemo(() => {
    const all: DayItem[] = [];
    const slotted: DayItem[] = [];
    for (const item of items) {
      const { date, time } = parseDue(item.due);
      if (date !== dateKey) continue; // LIKE is a prefix match; be exact about the day
      const placed = { ...item, minutes: time ? timeToMinutes(time) : -1 };
      (placed.minutes < 0 ? all : slotted).push(placed);
    }
    return { allDay: all, timed: layoutByTime(slotted) };
  }, [items, dateKey]);

  const [draft, setDraft] = useState<Draft | null>(null);

  function goToDay(delta: number): void {
    setDraft(null);
    void navigate({ to: "/calendar/$date", params: { date: toDateKey(addDays(day, delta)) } });
  }

  function openItem(item: DayItem): void {
    // The card renders inside its collection, which is workspace-scoped — so follow the item
    // rather than leaving the sidebar pointed somewhere else.
    if (item.workspaceId !== activeWorkspaceId) setActiveWorkspace(item.workspaceId);
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
        showWorkspace={showWorkspace}
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
          workspaces={workspaces}
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
        workspaces={workspaces}
        showWorkspace={showWorkspace}
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
  showWorkspace,
  onDropItem,
  onAdd,
}: {
  items: DayItem[];
  onOpen: (item: DayItem) => void;
  showWorkspace: boolean;
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
          <DayChip key={item.id} item={item} onOpen={onOpen} showWorkspace={showWorkspace} />
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
  workspaces,
  showWorkspace,
  onOpen,
  onPickSlot,
  onMoveItem,
  onCloseDraft,
}: {
  dateKey: string;
  isToday: boolean;
  items: Array<DayItem & { lane: number; lanes: number }>;
  draft: Draft | null;
  workspaces: WorkspaceRow[];
  showWorkspace: boolean;
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
              showWorkspace={showWorkspace}
              onGrab={(offset) => {
                grabOffset.current = offset;
              }}
            />
          ))}

          {draft && !draft.allDay ? (
            <QuickCreate
              dateKey={dateKey}
              minutes={draft.minutes}
              workspaces={workspaces}
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
  showWorkspace,
  onGrab,
}: {
  item: DayItem & { lane: number; lanes: number };
  onOpen: (item: DayItem) => void;
  showWorkspace: boolean;
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
      <WorkspaceBadge item={item} show={showWorkspace} />
    </button>
  );
}

function DayChip({
  item,
  onOpen,
  showWorkspace,
}: {
  item: DayItem;
  onOpen: (item: DayItem) => void;
  showWorkspace: boolean;
}) {
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
      className="flex max-w-full items-center gap-1.5 rounded border border-line bg-surface px-2 py-0.5 text-xs text-fg hover:bg-hover"
    >
      <span className="truncate">{item.title}</span>
      <WorkspaceBadge item={item} show={showWorkspace} />
    </button>
  );
}

/** Which workspace a task came from — the calendar is the one view that mixes them. */
function WorkspaceBadge({ item, show }: { item: DayItem; show: boolean }) {
  if (!show || !item.workspaceName) return null;
  return (
    <span
      data-testid="day-workspace-badge"
      className="ml-auto max-w-[40%] shrink-0 truncate rounded bg-hover px-1 text-[10px] text-subtle"
    >
      {item.workspaceName}
    </span>
  );
}

/* ------------------------------------------------------------------ quick create */

/**
 * The bubble Google pops when you click an empty slot: type a title, Enter to save.
 *
 * It asks for a destination only when there is genuinely a choice. `items.collection_id` is
 * required, so with two or more collections a silent guess buries the task somewhere you won't
 * look — but with one (or none) the question has a single answer and a picker reading "Untitled"
 * is just noise. The workspace is never a separate control: since the calendar spans workspaces,
 * choosing the collection already chooses the workspace, and the options are grouped by workspace
 * so that stays obvious. The default is the ACTIVE workspace's first collection — you are almost
 * always plotting into the one you're working in.
 */
function QuickCreate({
  dateKey,
  minutes,
  workspaces,
  onClose,
  className,
  style,
}: {
  dateKey: string;
  minutes: number;
  workspaces: WorkspaceRow[];
  onClose: () => void;
  className: string;
  style?: CSSProperties;
}) {
  const activeWorkspaceId = useUiStore((s) => s.activeWorkspaceId);
  const ids = useMemo(() => workspaces.map((workspace) => workspace.id), [workspaces]);
  const { data: collections } = useQuery<{ id: string; name: string; workspace_id: string }>(
    ids.length
      ? `SELECT id, name, workspace_id FROM collections WHERE workspace_id IN (${ids
          .map(() => "?")
          .join(", ")}) ORDER BY created_at`
      : "SELECT id, name, workspace_id FROM collections WHERE 1 = 0",
    ids,
  );

  const [title, setTitle] = useState("");
  const [time, setTime] = useState(minutes < 0 ? "" : minutesToTime(minutes));
  const [picked, setPicked] = useState("");
  const [saving, setSaving] = useState(false);

  const fallback =
    collections.find((collection) => collection.workspace_id === activeWorkspaceId) ??
    collections[0];
  const collectionId = picked || fallback?.id || "";
  const target = collections.find((collection) => collection.id === collectionId);

  /** Options grouped by workspace, so picking a collection visibly picks a workspace too. */
  const groups = useMemo(
    () =>
      workspaces
        .map((workspace) => ({
          workspace,
          collections: collections.filter((c) => c.workspace_id === workspace.id),
        }))
        .filter((group) => group.collections.length > 0),
    [workspaces, collections],
  );

  async function save(): Promise<void> {
    if (!target || !title.trim() || saving) return;
    setSaving(true);
    // The workspace comes from the chosen collection, never from the active one — they differ
    // whenever you plot into another workspace from here.
    await createItem(target.workspace_id, target.id, {
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
          {collections.length > 1 ? (
            <label className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-subtle">
              in
              <select
                value={collectionId}
                onChange={(event) => setPicked(event.target.value)}
                aria-label="Collection"
                data-testid="quick-create-collection"
                className="min-w-0 flex-1 rounded-lg border border-line bg-app px-2.5 py-1.5 text-xs text-muted outline-none focus:border-muted/60"
              >
                {groups.length > 1
                  ? groups.map((group) => (
                      <optgroup key={group.workspace.id} label={group.workspace.name}>
                        {group.collections.map((collection) => (
                          <option key={collection.id} value={collection.id}>
                            {collection.name}
                          </option>
                        ))}
                      </optgroup>
                    ))
                  : collections.map((collection) => (
                      <option key={collection.id} value={collection.id}>
                        {collection.name}
                      </option>
                    ))}
              </select>
            </label>
          ) : null}
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
