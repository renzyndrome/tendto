/**
 * Focus session history — the one synced part of focus mode.
 *
 * The timer itself is device-local UI state (`stores/focus.ts`); a *completed* work session is
 * durable personal history, so it goes to Postgres like everything else that matters. It is
 * USER-private, not workspace content: `focus_sessions` rides its own user-scoped bucket and
 * must never be added to `workspace_content`, which would put your Pomodoro history on every
 * teammate's device.
 *
 * All writes go to the local replica; PowerSync uploads them via the connector. No network here.
 */
import { toDateKey } from "../calendar";
import { db } from "../powersync/client";

/** One completed work session, as the stats layer wants it. */
export interface FocusSessionRow {
  id: string;
  user_id: string;
  started_at: string;
  local_date: string;
  minutes: number;
  created_at: string;
  updated_at: string;
}

/**
 * Record one completed work phase.
 *
 * `startedAt` is the real instant; the day is stored separately as the LOCAL one, because the
 * server can never recover the device's timezone from a UTC timestamp — without it a 9pm
 * session east of Greenwich files under tomorrow. `toDateKey` is the same local-date helper the
 * calendar uses (never `toISOString`, which is UTC).
 *
 * `minutes` is bound as a NUMBER: SQLite is dynamically typed, so a string would survive
 * locally and then be rejected by Postgres on upload — the failure would surface far from here.
 */
export async function recordFocusSession(
  userId: string,
  minutes: number,
  startedAt: Date,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO focus_sessions
       (id, user_id, started_at, local_date, minutes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, startedAt.toISOString(), toDateKey(startedAt), Math.round(minutes), now, now],
  );
  return id;
}
