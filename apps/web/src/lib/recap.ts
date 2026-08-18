/** Pure period math + response types for the Daily recap. No data access — like lib/calendar. */

import { addDays, parseDateKey, toDateKey } from "./calendar";

export const PERIODS = ["day", "week", "month", "all"] as const;
export type Period = (typeof PERIODS)[number];

export function isPeriod(value: unknown): value is Period {
  return typeof value === "string" && (PERIODS as readonly string[]).includes(value);
}

export interface PeriodRange {
  /** null = everything so far. */
  start: string | null;
  end: string;
}

/** The local date range a period covers around `anchorKey` (calendar-aligned, like the app). */
export function periodRange(period: Period, anchorKey: string): PeriodRange {
  const anchor = parseDateKey(anchorKey) ?? new Date();
  if (period === "day") return { start: anchorKey, end: anchorKey };
  if (period === "week") {
    const sunday = addDays(anchor, -anchor.getDay());
    return { start: toDateKey(sunday), end: toDateKey(addDays(sunday, 6)) };
  }
  if (period === "month") {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    return { start: toDateKey(first), end: toDateKey(last) };
  }
  return { start: null, end: toDateKey(new Date()) };
}

/** Step the anchor one period backwards/forwards. */
export function stepAnchor(period: Period, anchorKey: string, delta: -1 | 1): string {
  const anchor = parseDateKey(anchorKey) ?? new Date();
  if (period === "day") return toDateKey(addDays(anchor, delta));
  if (period === "week") return toDateKey(addDays(anchor, delta * 7));
  // month: land on the 1st so short months can't skip (Jan 31 + 1 month = Mar 3).
  return toDateKey(new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1));
}

export function periodLabel(period: Period, anchorKey: string): string {
  const anchor = parseDateKey(anchorKey) ?? new Date();
  if (period === "day") {
    return anchor.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }
  if (period === "week") {
    const { start, end } = periodRange("week", anchorKey);
    const from = parseDateKey(start ?? anchorKey) ?? anchor;
    const to = parseDateKey(end) ?? anchor;
    const short = { month: "short", day: "numeric" } as const;
    return `${from.toLocaleDateString(undefined, short)} – ${to.toLocaleDateString(undefined, short)}, ${to.getFullYear()}`;
  }
  if (period === "month") {
    return anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  return "Everything so far";
}

/** "Aug 19", or "today"/"tomorrow" when it is — for the due chips. */
export function shortDueLabel(dueKey: string): string {
  const todayKey = toDateKey(new Date());
  if (dueKey === todayKey) return "today";
  if (dueKey === toDateKey(addDays(new Date(), 1))) return "tomorrow";
  const date = parseDateKey(dueKey);
  if (!date) return dueKey;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// --- what POST /ai/daily-summary returns -------------------------------------------------

export interface DueItem {
  title: string;
  due: string; // YYYY-MM-DD
}

export interface RecapActivity {
  focus_minutes: number;
  focus_sessions: number;
  items_completed: string[];
  items_created: string[];
  pages_updated: string[];
  items_overdue: DueItem[];
  items_due_next: DueItem[];
}

export interface RecapResponse {
  start: string | null;
  end: string;
  summary: string;
  engine: string; // "offline" | "claude-cli" | "codex-cli" | "api" | ...
  activity: RecapActivity;
}
