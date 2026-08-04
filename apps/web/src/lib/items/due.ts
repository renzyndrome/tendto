/**
 * Due dates, with an OPTIONAL time.
 *
 * Stored in `item.properties.due` as either `YYYY-MM-DD` (all day) or `YYYY-MM-DDTHH:MM`
 * (a specific local time). Keeping the date as the prefix means everything that only cares
 * about the day — the calendar grid, the daily summary — can keep slicing the first 10
 * characters, and old date-only rows stay valid without a migration.
 *
 * Times are LOCAL wall-clock, deliberately not UTC: "the report is due at 5pm" means 5pm where
 * you are, and a synced replica shouldn't shift it when you travel.
 */

/** Empty when there is no due date at all. */
export interface DueParts {
  date: string; // "" | YYYY-MM-DD
  time: string; // "" | HH:MM
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export function parseDue(value: unknown): DueParts {
  if (typeof value !== "string" || value === "") return { date: "", time: "" };
  const [date, time = ""] = value.split("T");
  if (!DATE_RE.test(date)) return { date: "", time: "" };
  // Tolerate seconds ("14:30:00") from any older//external value.
  const hhmm = time.slice(0, 5);
  return { date, time: TIME_RE.test(hhmm) ? hhmm : "" };
}

/** Build the stored value. A time without a date is meaningless, so it is dropped. */
export function formatDue(date: string, time: string): string {
  if (!DATE_RE.test(date)) return "";
  return TIME_RE.test(time) ? `${date}T${time}` : date;
}

/** The `YYYY-MM-DD` a due value falls on — what the calendar buckets by. */
export function dueDateKey(value: unknown): string {
  return parseDue(value).date;
}

/**
 * The moment a due value refers to, in local time. All-day items resolve to the END of the
 * day: an item due "today" with no time isn't late at 00:01, it's due by bedtime.
 */
export function dueAt(value: unknown): Date | null {
  const { date, time } = parseDue(value);
  if (!date) return null;
  const [year, month, day] = date.split("-").map(Number);
  if (!time) return new Date(year, month - 1, day, 23, 59, 0, 0);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

/** Short human form for chips and lists: "Aug 4" or "Aug 4, 14:30". */
export function formatDueLabel(value: unknown): string {
  const { date, time } = parseDue(value);
  if (!date) return "";
  const at = dueAt(value);
  if (!at) return date;
  const day = at.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return time ? `${day}, ${time}` : day;
}
