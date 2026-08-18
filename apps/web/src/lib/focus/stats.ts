/**
 * Focus statistics — pure functions over recorded sessions. No data access, no React; the same
 * split as lib/calendar.ts, so the arithmetic can be reasoned about (and tested) on its own.
 *
 * The design rule these follow: **every number here is one you can only move by actually
 * focusing.** Nothing counts sessions started, app opens, or time with the tab in front —
 * metrics you can maximise without doing the work are the ones that turn into theatre.
 *
 * Days are the USER's local days, taken from each row's stored `local_date` rather than derived
 * from a timestamp, because the day a session belongs to is a wall-clock fact (see the API
 * model and lib/items/due.ts).
 */
import { addDays, toDateKey } from "../calendar";
import type { FocusSessionRow } from "./sessions";

/** How many weeks of history the heatmap shows. */
export const HEATMAP_WEEKS = 12;

export interface DayTotal {
  dateKey: string;
  minutes: number;
  sessions: number;
}

export interface FocusTotals {
  minutes: number;
  sessions: number;
}

export interface PersonalBests {
  /** Most minutes focused in a single day, ever. */
  bestDayMinutes: number;
  /** Most sessions completed in a single day, ever. */
  bestDaySessions: number;
  /** Most days focused within one Sunday-start week, ever. */
  bestWeekDays: number;
}

/** Minutes and sessions per local day, keyed by `YYYY-MM-DD`. */
export function totalsByDay(rows: FocusSessionRow[]): Map<string, DayTotal> {
  const map = new Map<string, DayTotal>();
  for (const row of rows) {
    const dateKey = row.local_date;
    if (!dateKey) continue;
    const current = map.get(dateKey) ?? { dateKey, minutes: 0, sessions: 0 };
    map.set(dateKey, {
      dateKey,
      minutes: current.minutes + (Number(row.minutes) || 0),
      sessions: current.sessions + 1,
    });
  }
  return map;
}

export function totalsFor(byDay: Map<string, DayTotal>, dateKeys: string[]): FocusTotals {
  return dateKeys.reduce<FocusTotals>(
    (acc, key) => {
      const day = byDay.get(key);
      return day
        ? { minutes: acc.minutes + day.minutes, sessions: acc.sessions + day.sessions }
        : acc;
    },
    { minutes: 0, sessions: 0 },
  );
}

/** The Sunday-start week `date` falls in, as local date keys — matching the calendar's grid. */
export function weekKeys(date: Date): string[] {
  const sunday = addDays(date, -date.getDay());
  return Array.from({ length: 7 }, (_, i) => toDateKey(addDays(sunday, i)));
}

/**
 * `HEATMAP_WEEKS` weeks ending with the week `date` falls in, oldest first — a flat list of
 * local date keys, one per day, so the grid can be laid out column-per-week.
 */
export function heatmapKeys(date: Date): string[] {
  const sunday = addDays(date, -date.getDay());
  const start = addDays(sunday, -7 * (HEATMAP_WEEKS - 1));
  return Array.from({ length: HEATMAP_WEEKS * 7 }, (_, i) => toDateKey(addDays(start, i)));
}

/**
 * Intensity bucket 0–4 for a day's minutes, for the heatmap's alpha ramp. Fixed thresholds
 * rather than relative-to-your-best: a scale that rescales itself means a good day can *dim*
 * because a later day was better, which reads as losing progress you already earned.
 */
export function intensity(minutes: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes <= 0) return 0;
  if (minutes < 30) return 1;
  if (minutes < 60) return 2;
  if (minutes < 120) return 3;
  return 4;
}

/** Minutes focused per local hour of the day (24 buckets) — "when do I actually focus". */
export function minutesByHour(rows: FocusSessionRow[]): number[] {
  const hours = new Array<number>(24).fill(0);
  for (const row of rows) {
    const at = new Date(row.started_at);
    if (Number.isNaN(at.getTime())) continue;
    hours[at.getHours()] += Number(row.minutes) || 0;
  }
  return hours;
}

/**
 * Records that only ever go up. There is deliberately no streak here: a counter that resets to
 * zero on one missed day turns a tool into a debt, which is the failure mode the research on
 * streak mechanics keeps finding. "Days focused this week" carries the same signal without the
 * cliff.
 */
export function personalBests(byDay: Map<string, DayTotal>): PersonalBests {
  let bestDayMinutes = 0;
  let bestDaySessions = 0;
  const daysPerWeek = new Map<string, number>();

  for (const day of byDay.values()) {
    if (day.minutes <= 0) continue;
    bestDayMinutes = Math.max(bestDayMinutes, day.minutes);
    bestDaySessions = Math.max(bestDaySessions, day.sessions);
    // Group by the week's Sunday so "days focused in a week" matches what the grid shows.
    const [year, month, dayOfMonth] = day.dateKey.split("-").map(Number);
    const date = new Date(year, month - 1, dayOfMonth);
    const sunday = toDateKey(addDays(date, -date.getDay()));
    daysPerWeek.set(sunday, (daysPerWeek.get(sunday) ?? 0) + 1);
  }

  return {
    bestDayMinutes,
    bestDaySessions,
    bestWeekDays: Math.max(0, ...daysPerWeek.values()),
  };
}

/** "1h 25m" / "45m" / "—". Minutes are the unit everywhere; this is display only. */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
