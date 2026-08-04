/**
 * Due reminders — watches the local replica for items coming due today and fires one desktop
 * notification each.
 *
 * Entirely device-local: it reads the replica (so it works offline) and keeps its "already
 * told you" set in localStorage. There is no server job and no push channel — a reminder is a
 * property of the device you're sitting at, not an event pushed at every device you own.
 *
 * Rules that keep it calm:
 *   - only items due TODAY (an overdue backlog would notify in bulk on every launch)
 *   - never an item already in its board's last (done) column
 *   - a timed item fires at its time; an all-day item fires on first check of that day
 *   - one notification per item per due value: editing the due date re-arms it, re-opening the
 *     app does not
 */
import { db } from "../powersync/client";
import { notify, notificationsEnabled } from "../notifications";
import { toDateKey } from "../calendar";
import { parseColumns } from "./mutations";
import { dueAt, formatDueLabel, parseDue } from "./due";

const SEEN_KEY = "tendto:due-notified";
const CHECK_MS = 60_000;

interface DueRow {
  id: string;
  collection_id: string;
  properties: string;
  config: string | null;
}

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeSeen(seen: Set<string>): void {
  try {
    // Bounded: only today's keys are ever added, and old days are dropped on write.
    const today = toDateKey(new Date());
    const kept = [...seen].filter((key) => key.includes(`:${today}`));
    localStorage.setItem(SEEN_KEY, JSON.stringify(kept));
  } catch {
    // Storage unavailable — worst case a reminder repeats after a reload.
  }
}

let inFlight: Promise<number> | null = null;

/**
 * One pass. Concurrent calls are COALESCED onto the in-flight one: the interval, the focus
 * listener and the visibility listener can all fire within milliseconds of each other, and
 * because a pass reads the "already notified" set at the start and writes it at the end, two
 * overlapping passes would both decide an item was un-notified and fire twice.
 */
export function checkDueItems(workspaceId: string | null): Promise<number> {
  if (inFlight) return inFlight;
  inFlight = runCheck(workspaceId).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runCheck(workspaceId: string | null): Promise<number> {
  if (!workspaceId || !notificationsEnabled()) return 0;

  const today = toDateKey(new Date());
  const rows = await db.getAll<DueRow>(
    `SELECT i.id, i.collection_id, i.properties, c.config
       FROM items i LEFT JOIN collections c ON c.id = i.collection_id
      WHERE i.workspace_id = ?`,
    [workspaceId],
  );

  const seen = readSeen();
  const now = Date.now();
  let fired = 0;

  for (const row of rows) {
    let props: Record<string, unknown>;
    try {
      props = JSON.parse(row.properties) as Record<string, unknown>;
    } catch {
      continue;
    }
    const due = typeof props.due === "string" ? props.due : "";
    const { date, time } = parseDue(due);
    if (date !== today) continue; // today only

    // Done items don't nag. "Done" is the board's LAST column, matching the checklist.
    const columns = parseColumns(row.config);
    const doneId = columns[columns.length - 1]?.id;
    if (typeof props.status === "string" && props.status === doneId) continue;

    const key = `${row.id}:${due}`;
    if (seen.has(key)) continue;

    // A timed item waits for its moment; an all-day item fires on the first check today.
    const at = dueAt(due);
    if (time && at && at.getTime() > now) continue;

    const title = typeof props.title === "string" && props.title ? props.title : "Untitled";
    // Mark BEFORE notifying and persist immediately: if anything below throws, or the tab is
    // closed mid-pass, the reminder is not repeated on next launch.
    seen.add(key);
    writeSeen(seen);
    notify(time ? `Due now: ${title}` : `Due today: ${title}`, {
      body: formatDueLabel(due),
      tag: `tendto-due-${row.id}`,
    });
    fired += 1;
  }

  writeSeen(seen);
  return fired;
}

/**
 * Start watching. Returns a stop function.
 *
 * Polling (rather than reacting to replica changes) is intentional: a reminder is
 * time-triggered, so it must fire even when nothing changed. It also re-checks whenever the
 * tab becomes visible or focused — background timers are throttled hard, and a laptop that
 * slept through a deadline should tell you when you come back rather than up to a minute later.
 */
export function startDueWatcher(getWorkspaceId: () => string | null): () => void {
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    void checkDueItems(getWorkspaceId()).catch(() => undefined);
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") tick();
  };

  tick(); // catch anything already due at launch
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
