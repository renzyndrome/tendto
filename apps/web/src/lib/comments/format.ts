/**
 * Relative timestamps for comments, and for a page's created / edited line.
 *
 * Deliberately coarse: a comment thread wants "3h" not "3 hours, 12 minutes ago". Anything
 * older than a week reads better as a date, so it switches rather than counting weeks up.
 *
 * Both functions take either an instant (epoch ms) or a timestamp string. Strings are parsed
 * with `toInstant`, not `new Date`, because a column that has been up to the server and back
 * is spelled `2026-09-03 15:55:42.276+00` rather than as ISO, and `new Date` does not parse
 * that reliably.
 */
import { toInstant } from "../blocks/self-writes";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Epoch ms from either form; NaN when the value is not a time at all. */
function instantOf(value: string | number): number {
  return typeof value === "number" ? value : toInstant(value);
}

/** A short, calm "when": "just now", "5m", "3h", "2d", then an absolute date. */
export function timeAgo(value: string | number, now: Date = new Date()): string {
  const then = new Date(instantOf(value));
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
export function exactTime(value: string | number): string {
  const at = new Date(instantOf(value));
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleString();
}

/** A calendar date without the time: "Sep 10", or "Sep 10, 2025" in another year. */
export function shortDate(value: string | number, now: Date = new Date()): string {
  const at = new Date(instantOf(value));
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}
