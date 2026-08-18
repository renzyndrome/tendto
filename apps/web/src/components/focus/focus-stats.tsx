/**
 * What your focus actually looks like — the garden, a consistency heatmap, your peak hours and
 * your personal bests, all read live from the replica.
 *
 * Everything here is REFLECTIVE: it shows you your own behaviour and never nags, ranks or
 * compares you to anyone. No streak counter, because a number that resets to zero on one missed
 * day turns the tool into a debt; "days focused this week" says the same thing without the
 * cliff. And no points or levels — the research on gamified productivity is consistent that
 * extrinsic scoring erodes the motivation it is meant to support.
 */
import { useQuery } from "@powersync/react";
import { useMemo } from "react";

import { toDateKey } from "../../lib/calendar";
import type { FocusSessionRow } from "../../lib/focus/sessions";
import {
  formatMinutes,
  heatmapKeys,
  HEATMAP_WEEKS,
  intensity,
  minutesByHour,
  personalBests,
  totalsByDay,
  totalsFor,
  weekKeys,
  type DayTotal,
} from "../../lib/focus/stats";
import { Garden } from "./garden";

/** Alpha ramp on the accent token — token-native, so it stays correct in both themes. */
const INTENSITY_CLASS = [
  "bg-hover",
  "bg-accent/20",
  "bg-accent/40",
  "bg-accent/70",
  "bg-accent",
] as const;

export function FocusStats() {
  // No user_id filter: the `user_private` sync bucket only ever puts YOUR sessions in this
  // replica, and signing out clears the database outright (see lib/powersync/client.ts).
  const { data: rows } = useQuery<FocusSessionRow>(
    "SELECT * FROM focus_sessions ORDER BY started_at",
  );

  const today = useMemo(() => new Date(), []);
  const todayKey = toDateKey(today);

  const byDay = useMemo(() => totalsByDay(rows), [rows]);
  const thisWeek = useMemo(() => weekKeys(today), [today]);
  const weekTotals = useMemo(() => totalsFor(byDay, thisWeek), [byDay, thisWeek]);
  const todayTotals = useMemo(() => totalsFor(byDay, [todayKey]), [byDay, todayKey]);
  const bests = useMemo(() => personalBests(byDay), [byDay]);
  const hours = useMemo(() => minutesByHour(rows), [rows]);

  const week: DayTotal[] = thisWeek.map(
    (dateKey) => byDay.get(dateKey) ?? { dateKey, minutes: 0, sessions: 0 },
  );
  const daysFocused = week.filter((day) => day.minutes > 0).length;

  if (rows.length === 0) {
    return (
      <section data-testid="focus-stats" className="mt-10 w-full border-t border-line pt-6">
        <p className="text-center text-xs text-subtle">
          Finish a focus session and your garden starts here.
        </p>
      </section>
    );
  }

  return (
    <section data-testid="focus-stats" className="mt-10 w-full border-t border-line pt-6">
      <Garden week={week} todayKey={todayKey} />

      <div className="mt-4 flex flex-wrap items-baseline justify-center gap-x-5 gap-y-1 text-xs text-muted">
        <span data-testid="stat-today">
          Today <strong className="font-medium text-fg">{formatMinutes(todayTotals.minutes)}</strong>
        </span>
        <span data-testid="stat-week">
          This week{" "}
          <strong className="font-medium text-fg">{formatMinutes(weekTotals.minutes)}</strong> ·{" "}
          {weekTotals.sessions} {weekTotals.sessions === 1 ? "session" : "sessions"}
        </span>
        <span data-testid="stat-days">
          {daysFocused}/7 days
        </span>
      </div>

      <Heatmap byDay={byDay} today={today} todayKey={todayKey} />
      <PeakHours hours={hours} />

      <dl className="mt-5 grid grid-cols-3 gap-2 text-center">
        <Best label="Best day" value={formatMinutes(bests.bestDayMinutes)} />
        <Best label="Most sessions" value={bests.bestDaySessions ? `${bests.bestDaySessions}` : "—"} />
        <Best label="Best week" value={bests.bestWeekDays ? `${bests.bestWeekDays} days` : "—"} />
      </dl>
    </section>
  );
}

function Best({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line px-2 py-2">
      <dt className="text-[10px] uppercase tracking-wide text-subtle">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium tabular-nums text-fg">{value}</dd>
    </div>
  );
}

/** 12 weeks of consistency, one column per week — the GitHub-contributions idiom. */
function Heatmap({
  byDay,
  today,
  todayKey,
}: {
  byDay: Map<string, DayTotal>;
  today: Date;
  todayKey: string;
}) {
  const keys = useMemo(() => heatmapKeys(today), [today]);
  const weeks = useMemo(
    () => Array.from({ length: HEATMAP_WEEKS }, (_, w) => keys.slice(w * 7, w * 7 + 7)),
    [keys],
  );

  return (
    <div className="mt-6">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wide text-subtle">Last 12 weeks</span>
        <span className="flex items-center gap-1 text-[10px] text-subtle">
          Less
          {INTENSITY_CLASS.map((cls, i) => (
            <span key={i} className={`h-2.5 w-2.5 rounded-sm ${cls}`} />
          ))}
          More
        </span>
      </div>
      {/* justify-center so the 12 narrow columns sit under the centred column above, not adrift
          against its left edge. */}
      <div
        data-testid="focus-heatmap"
        className="flex justify-center gap-1 overflow-x-auto pb-1"
      >
        {weeks.map((week) => (
          <div key={week[0]} className="flex flex-col gap-1">
            {week.map((dateKey) => {
              const minutes = byDay.get(dateKey)?.minutes ?? 0;
              const future = dateKey > todayKey;
              return (
                <span
                  key={dateKey}
                  title={`${dateKey} — ${formatMinutes(minutes)}`}
                  data-minutes={minutes}
                  className={
                    "h-3 w-3 shrink-0 rounded-sm " +
                    (future ? "bg-hover/40" : INTENSITY_CLASS[intensity(minutes)])
                  }
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** When you actually focus. Bars are relative to your own busiest hour, not an absolute scale. */
function PeakHours({ hours }: { hours: number[] }) {
  const peak = Math.max(...hours);
  if (peak <= 0) return null;

  return (
    <div className="mt-6">
      <span className="text-[10px] uppercase tracking-wide text-subtle">Peak hours</span>
      <div data-testid="focus-peak-hours" className="mt-1.5 flex h-12 items-end gap-px">
        {hours.map((minutes, hour) => (
          <span
            key={hour}
            title={`${String(hour).padStart(2, "0")}:00 — ${formatMinutes(minutes)}`}
            style={{ height: `${Math.max(minutes > 0 ? 8 : 2, (minutes / peak) * 100)}%` }}
            className={"flex-1 rounded-sm " + (minutes > 0 ? "bg-accent/60" : "bg-hover")}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-subtle">
        <span>12a</span>
        <span>6a</span>
        <span>12p</span>
        <span>6p</span>
        <span>11p</span>
      </div>
    </div>
  );
}
