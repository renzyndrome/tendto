/** Pure date helpers for the unified calendar. No data access — just Date math. */

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Local `YYYY-MM-DD` key (built from local components — never `toISOString`, which is UTC). */
export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** First day of the month `delta` months from `date`. */
export function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

/**
 * 42 days (6 weeks, Sunday-first) covering the month `viewDate` falls in. A fixed 6-row grid
 * keeps the layout stable across months; days outside the month are rendered muted.
 */
export function monthGrid(viewDate: Date): Date[] {
  const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    return day;
  });
}

export function formatMonthLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/* ------------------------------------------------------------------ day view */

/** Hour rows in the day grid — a full day, like Google Calendar's. */
export const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/**
 * The grid's granularity, in minutes: clicks and drops snap to it, and an item is drawn as one
 * slot tall. Items are DEADLINES, not meetings — they have no duration — so the block is a
 * readable anchor, not a claim about how long the task takes.
 */
export const SLOT_MINUTES = 30;

export const MINUTES_PER_DAY = 24 * 60;

export function addDays(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta);
}

/** Local midnight for a `YYYY-MM-DD` key, or null if it isn't one. Never `new Date(key)` — UTC. */
export function parseDateKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDayLabel(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** "9 AM" — or "09" in a 24-hour locale, which is why this is `toLocaleTimeString`. */
export function formatHourLabel(hour: number): string {
  return new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, { hour: "numeric" });
}

/** Minutes since local midnight for `HH:MM`; -1 when it isn't a time. */
export function timeToMinutes(time: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return -1;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.round(minutes)));
  const hour = String(Math.floor(clamped / 60)).padStart(2, "0");
  const minute = String(clamped % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

/** Snap to the slot a click/drop landed in, keeping a whole block inside the day. */
export function snapToSlot(minutes: number): number {
  const snapped = Math.floor(minutes / SLOT_MINUTES) * SLOT_MINUTES;
  return Math.max(0, Math.min(MINUTES_PER_DAY - SLOT_MINUTES, snapped));
}

export interface Laid {
  /** Which of `lanes` side-by-side columns this entry occupies. */
  lane: number;
  /** How many columns the overlapping cluster was split into. */
  lanes: number;
}

/**
 * Side-by-side layout for entries that collide in time — Google Calendar's behaviour when two
 * events share a slot.
 *
 * Entries are grouped into clusters that actually overlap (each block runs `SLOT_MINUTES`), then
 * each cluster is split into as many lanes as it needs. Grouping first is what keeps an isolated
 * item full-width instead of narrowing every item on the day to match the busiest moment.
 */
export function layoutByTime<T extends { minutes: number }>(entries: T[]): Array<T & Laid> {
  const sorted = [...entries].sort((a, b) => a.minutes - b.minutes);

  const clusters: T[][] = [];
  let cluster: T[] = [];
  let clusterEnd = -1;
  for (const entry of sorted) {
    if (cluster.length > 0 && entry.minutes >= clusterEnd) {
      clusters.push(cluster);
      cluster = [];
      clusterEnd = -1;
    }
    cluster.push(entry);
    clusterEnd = Math.max(clusterEnd, entry.minutes + SLOT_MINUTES);
  }
  if (cluster.length > 0) clusters.push(cluster);

  return clusters.flatMap((group) => {
    const laneEnds: number[] = [];
    const placed = group.map((entry) => {
      const free = laneEnds.findIndex((end) => end <= entry.minutes);
      const lane = free === -1 ? laneEnds.length : free;
      laneEnds[lane] = entry.minutes + SLOT_MINUTES;
      return { entry, lane };
    });
    return placed.map(({ entry, lane }) => ({ ...entry, lane, lanes: laneEnds.length }));
  });
}
