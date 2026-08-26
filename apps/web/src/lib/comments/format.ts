/**
 * Relative timestamps for comments.
 *
 * Deliberately coarse: a comment thread wants "3h" not "3 hours, 12 minutes ago". Anything
 * older than a week reads better as a date, so it switches rather than counting weeks up.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** A short, calm "when": "just now", "5m", "3h", "2d", then an absolute date. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const elapsed = now.getTime() - then.getTime();
  if (Number.isNaN(elapsed)) return "";
  // A clock skewed slightly ahead (another device's) shouldn't read "in -2 minutes".
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d`;
  const sameYear = then.getFullYear() === now.getFullYear();
  return then.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** The full instant, for the title attribute — the precise answer is one hover away. */
export function exactTime(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleString();
}
