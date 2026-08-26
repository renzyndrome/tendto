/**
 * The evening recap — the ambient half of the daily summary (doc 01 §signature, doc 06).
 *
 * Device-local, like due reminders and for the same reasons. A server cron would need to know
 * every user's timezone, and the server deliberately never learns it — that is why `local_date`
 * is stored as a wall-clock string in the first place. It would also have no way to reach you:
 * email is provider-agnostic but unconfigured, so a "delivery" job would deliver nothing. And
 * it would spend inference every evening for every account whether or not anyone ever looked.
 *
 * So: while the app is open, at or after your chosen hour, it fetches today's recap once and
 * tells you. The honest limitation is that a device which is asleep at 9pm gets nothing — the
 * recap page is always there, and a notification about yesterday at breakfast is noise, not a
 * feature.
 *
 * Settings are per DEVICE, matching the notifications toggle (see lib/notifications.ts), which
 * is deliberately per-device too: the thing being configured is what this machine does at 9pm.
 */
import { apiFetch } from "./api/client";
import { toDateKey } from "./calendar";
import { notificationsEnabled, notify } from "./notifications";
import type { RecapResponse } from "./recap";

const SETTINGS_KEY = "tendto:recap-schedule";
const DELIVERED_KEY = "tendto:recap-delivered";
const CHECK_MS = 60_000;

export interface RecapSchedule {
  /** On by default: the daily summary is the product's signature ambient feature (doc 01 §4),
   *  and nothing fires anyway unless desktop notifications are separately switched on. */
  enabled: boolean;
  /** Local hour, 0–23. Evening by default — the recap is a look back, not a to-do list. */
  hour: number;
  minute: number;
}

export const DEFAULT_SCHEDULE: RecapSchedule = { enabled: true, hour: 21, minute: 0 };

export function readSchedule(): RecapSchedule {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SCHEDULE;
    const parsed = JSON.parse(raw) as Partial<RecapSchedule>;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_SCHEDULE.enabled,
      hour: clamp(parsed.hour, 0, 23, DEFAULT_SCHEDULE.hour),
      minute: clamp(parsed.minute, 0, 59, DEFAULT_SCHEDULE.minute),
    };
  } catch {
    return DEFAULT_SCHEDULE;
  }
}

export function writeSchedule(schedule: RecapSchedule): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(schedule));
  } catch {
    // Storage unavailable — the setting just won't survive a reload.
  }
}

function clamp(value: unknown, low: number, high: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(high, Math.max(low, Math.round(value)));
}

/** "9:00 pm" — how the schedule reads in the UI. */
export function formatScheduleTime(schedule: RecapSchedule): string {
  const at = new Date();
  at.setHours(schedule.hour, schedule.minute, 0, 0);
  return at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** The `<input type="time">` value for a schedule, and back again. */
export const toTimeValue = (schedule: RecapSchedule): string =>
  `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;

export function fromTimeValue(value: string, current: RecapSchedule): RecapSchedule {
  const [hour, minute] = value.split(":").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return current;
  return { ...current, hour: clamp(hour, 0, 23, current.hour), minute: clamp(minute, 0, 59, 0) };
}

function readDelivered(): string {
  try {
    return localStorage.getItem(DELIVERED_KEY) ?? "";
  } catch {
    return "";
  }
}

function markDelivered(dateKey: string): void {
  try {
    localStorage.setItem(DELIVERED_KEY, dateKey);
  } catch {
    // Worst case the recap is delivered twice after a reload.
  }
}

/**
 * Fetch and show a recap right now, ignoring the clock and the "already delivered" marker.
 *
 * The point is proof: someone who has just configured an AI engine wants to know it works
 * without waiting until nine o'clock to find out it doesn't.
 */
export async function sendRecapNow(onOpen: () => void): Promise<void> {
  const recap = await fetchToday();
  notify("Your evening recap", {
    body: summarise(recap),
    tag: "tendto-recap",
    onClick: onOpen,
  });
}

/**
 * A one-line "here's your day", built from the STRUCTURED digest rather than the prose.
 *
 * Deliberate: the digest is a plain database read, so this reads correctly whether or not an
 * AI engine is configured. The prose is the reward for opening the recap, not the notification.
 */
export function summarise(recap: RecapResponse): string {
  const { activity } = recap;
  const parts: string[] = [];
  if (activity.items_completed.length > 0) {
    parts.push(`${activity.items_completed.length} done`);
  }
  if (activity.focus_minutes > 0) parts.push(`${activity.focus_minutes}m focused`);
  if (activity.pages_updated.length > 0) {
    parts.push(`${activity.pages_updated.length} pages touched`);
  }
  if (activity.items_overdue.length > 0) {
    parts.push(`${activity.items_overdue.length} overdue`);
  }
  if (activity.items_due_next.length > 0) {
    parts.push(`${activity.items_due_next.length} due soon`);
  }
  return parts.length > 0 ? parts.join(" · ") : "A calm day — nothing tracked.";
}

async function fetchToday(): Promise<RecapResponse> {
  const today = toDateKey(new Date());
  const res = await apiFetch("/ai/daily-summary", {
    method: "POST",
    body: JSON.stringify({ date: today, today }),
  });
  return (await res.json()) as RecapResponse;
}

let inFlight: Promise<boolean> | null = null;

/**
 * One pass. Returns whether a recap was delivered.
 *
 * Concurrent calls are COALESCED, exactly as the due watcher does: the interval, the focus
 * listener and the visibility listener can all fire within milliseconds, and a pass reads the
 * "already delivered" marker at the start — two overlapping passes would both decide today was
 * undelivered and bill two AI calls for one evening.
 */
export function checkEveningRecap(onOpen: () => void, now: Date = new Date()): Promise<boolean> {
  if (inFlight) return inFlight;
  inFlight = runCheck(onOpen, now).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runCheck(onOpen: () => void, now: Date): Promise<boolean> {
  const schedule = readSchedule();
  if (!schedule.enabled || !notificationsEnabled()) return false;

  const today = toDateKey(now);
  if (readDelivered() === today) return false;

  const dueAt = new Date(now);
  dueAt.setHours(schedule.hour, schedule.minute, 0, 0);
  if (now.getTime() < dueAt.getTime()) return false;

  /*
   * Mark BEFORE fetching, not after. This costs an AI call, and a failure that left the day
   * unmarked would retry every minute until midnight — a bad evening for the operator's
   * subscription. One attempt per day is the right trade; the recap page is one click away.
   */
  markDelivered(today);

  const recap = await fetchToday();
  notify("Your evening recap", {
    body: summarise(recap),
    // One tag, so a second device's recap replaces rather than stacks.
    tag: "tendto-recap",
    onClick: onOpen,
  });
  return true;
}

/**
 * Start watching. Returns a stop function.
 *
 * Polls rather than scheduling a single timeout at the target hour: a laptop that sleeps
 * through 9pm never fires a timeout, and background timers are throttled hard. Re-checking on
 * focus and visibility is what makes "opened the lid at 10pm" work.
 */
export function startRecapWatcher(onOpen: () => void): () => void {
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    void checkEveningRecap(onOpen).catch(() => undefined);
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") tick();
  };

  tick();
  const handle = window.setInterval(tick, CHECK_MS);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", tick);

  return () => {
    stopped = true;
    window.clearInterval(handle);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", tick);
  };
}
