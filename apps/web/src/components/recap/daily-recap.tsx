/**
 * Daily recap — the surface for TendTo's one ambient AI feature (doc 06 AI-1), over a chosen
 * period: a day, a week, a month, or everything so far.
 *
 * The summary is generated SERVER-side over Postgres (the source of truth), so unlike every
 * content view this one needs the API. The response carries the STRUCTURED digest alongside
 * the prose, so the facts render as designed elements — overdue in the danger colour, upcoming
 * in the warn colour — rather than as a text blob. When the server runs the offline engine the
 * prose would just repeat the digest, so it is hidden and the structure speaks for itself.
 *
 * A day is a ROUTE (`/recap/$date?period=…`), like the calendar's — linkable, Back steps out,
 * reload stays put. Responses are cached per period+anchor for the session so browsing history
 * doesn't re-bill the model (or the operator's CLI subscription); ranges that include today
 * refetch on each visit, since today keeps happening.
 */
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { apiFetch } from "../../lib/api/client";
import { toDateKey } from "../../lib/calendar";
import { formatMinutes } from "../../lib/focus/stats";
import { RecapScheduleControl } from "./recap-schedule-control";
import {
  PERIODS,
  periodLabel,
  periodRange,
  shortDueLabel,
  stepAnchor,
  type DueItem,
  type Period,
  type RecapResponse,
} from "../../lib/recap";

interface RecapState {
  status: "loading" | "ready" | "error";
  data: RecapResponse | null;
}

const PERIOD_LABELS: Record<Period, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  all: "All",
};

/** Session-scoped response cache, keyed period+anchor. */
const cache = new Map<string, RecapResponse>();

export function DailyRecap({ anchorKey, period }: { anchorKey: string; period: Period }) {
  const navigate = useNavigate();
  const todayKey = toDateKey(new Date());
  const range = periodRange(period, anchorKey);
  const includesToday = range.end >= todayKey;

  const [recap, setRecap] = useState<RecapState>({ status: "loading", data: null });

  useEffect(() => {
    let cancelled = false;
    const key = `${period}:${anchorKey}`;
    // A finished period never changes, so its cache is authoritative. A period that includes
    // today grows as the day does — refetch it, using the cache only as an instant preview.
    const cached = cache.get(key);
    if (cached) setRecap({ status: "ready", data: cached });
    const stillGrowing = periodRange(period, anchorKey).end >= toDateKey(new Date());
    if (cached && !stillGrowing) return;

    if (!cached) setRecap({ status: "loading", data: null });
    const { start, end } = periodRange(period, anchorKey);
    apiFetch("/ai/daily-summary", {
      method: "POST",
      body: JSON.stringify({ start, end, today: toDateKey(new Date()) }),
    })
      .then(async (res) => {
        const data = (await res.json()) as RecapResponse;
        cache.set(key, data);
        if (!cancelled) setRecap({ status: "ready", data });
      })
      .catch(() => {
        if (!cancelled && !cached) setRecap({ status: "error", data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [period, anchorKey]);

  function open(nextPeriod: Period, nextAnchor: string): void {
    void navigate({
      to: "/recap/$date",
      params: { date: nextAnchor },
      search: { period: nextPeriod },
    });
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col overflow-y-auto px-6 py-8">
      <header className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-fg">Daily recap</h1>
          <div
            role="group"
            aria-label="Period"
            className="flex rounded-lg border border-line p-0.5"
          >
            {PERIODS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => open(option, anchorKey)}
                data-testid={`recap-period-${option}`}
                className={
                  "rounded-md px-3 py-1 text-xs " +
                  (option === period
                    ? "bg-hover font-medium text-fg"
                    : "text-muted hover:text-fg")
                }
              >
                {PERIOD_LABELS[option]}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-3">
          <p data-testid="recap-label" className="text-sm text-muted">
            {periodLabel(period, anchorKey)}
          </p>
          {period !== "all" ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => open(period, stepAnchor(period, anchorKey, -1))}
                aria-label="Previous period"
                className="rounded-md px-2 py-0.5 text-sm text-muted hover:bg-hover hover:text-fg"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => open(period, todayKey)}
                className="rounded-md px-2.5 py-0.5 text-sm text-muted hover:bg-hover hover:text-fg"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => open(period, stepAnchor(period, anchorKey, 1))}
                disabled={includesToday}
                aria-label="Next period"
                className="rounded-md px-2 py-0.5 text-sm text-muted hover:bg-hover hover:text-fg disabled:opacity-30"
              >
                ›
              </button>
            </div>
          ) : null}
        </div>
        <RecapScheduleControl onOpenRecap={() => open(period, anchorKey)} />
      </header>

      {recap.status === "loading" ? (
        <p data-testid="recap-loading" className="text-sm text-subtle">
          Looking back…
        </p>
      ) : recap.status === "error" ? (
        <p className="text-sm text-subtle">
          The recap is built on the server from your synced data, so it needs the API to be
          reachable. Everything else keeps working offline — try again once you're back online.
        </p>
      ) : recap.data ? (
        <RecapBody data={recap.data} />
      ) : null}
    </div>
  );
}

function RecapBody({ data }: { data: RecapResponse }) {
  const { activity } = data;
  const needsAttention = activity.items_overdue.length + activity.items_due_next.length > 0;
  const hasActivity =
    activity.focus_sessions > 0 ||
    activity.items_completed.length > 0 ||
    activity.items_created.length > 0 ||
    activity.pages_updated.length > 0;
  const offline = data.engine === "offline";

  if (!needsAttention && !hasActivity) {
    return (
      <p data-testid="recap-body" className="text-sm text-subtle">
        Nothing tracked in this period — a calm stretch.
      </p>
    );
  }

  return (
    <div data-testid="recap-body" className="space-y-4">
      {needsAttention ? (
        <section className="rounded-xl border border-line bg-surface px-5 py-4">
          <h2 className="mb-2.5 text-[10px] font-medium uppercase tracking-wide text-subtle">
            Needs attention
          </h2>
          <ul className="space-y-1.5">
            {activity.items_overdue.map((item) => (
              <DueRow key={`o-${item.title}-${item.due}`} item={item} kind="overdue" />
            ))}
            {activity.items_due_next.map((item) => (
              <DueRow key={`n-${item.title}-${item.due}`} item={item} kind="upcoming" />
            ))}
          </ul>
        </section>
      ) : null}

      {hasActivity ? (
        <div className="flex flex-wrap gap-2" data-testid="recap-stats">
          {activity.focus_sessions > 0 ? (
            <StatChip
              label="Focused"
              value={`${formatMinutes(activity.focus_minutes)} · ${activity.focus_sessions} ${
                activity.focus_sessions === 1 ? "session" : "sessions"
              }`}
            />
          ) : null}
          {activity.items_completed.length > 0 ? (
            <StatChip label="Done" value={`${activity.items_completed.length}`} />
          ) : null}
          {activity.items_created.length > 0 ? (
            <StatChip label="Added" value={`${activity.items_created.length}`} />
          ) : null}
          {activity.pages_updated.length > 0 ? (
            <StatChip label="Pages touched" value={`${activity.pages_updated.length}`} />
          ) : null}
        </div>
      ) : null}

      {/* The AI's narrative, when an engine is configured. The offline engine's "prose" is the
          digest verbatim, which the structured sections below already show — so offline gets a
          hint instead of a duplicate. */}
      {offline ? null : (
        <article
          data-testid="recap-prose"
          className="whitespace-pre-wrap rounded-xl border border-line bg-surface px-5 py-4 text-sm leading-relaxed text-fg"
        >
          {data.summary}
        </article>
      )}

      {/* The raw activity, always — the facts stay visible whether or not anything narrates them. */}
      <NameList label="Completed" names={activity.items_completed} />
      <NameList label="Added" names={activity.items_created} />
      <NameList label="Pages updated" names={activity.pages_updated} />

      {offline ? (
        <p className="pt-1 text-xs text-subtle">
          For a written recap, point the server at an AI engine — AI_CLI=claude or an
          AI_API_KEY in .env.
        </p>
      ) : null}
    </div>
  );
}

function DueRow({ item, kind }: { item: DueItem; kind: "overdue" | "upcoming" }) {
  const overdue = kind === "overdue";
  return (
    <li className="flex items-baseline gap-2.5 text-sm" data-testid={`recap-${kind}`}>
      <span
        aria-hidden
        className={
          "h-2 w-2 shrink-0 translate-y-px rounded-full " + (overdue ? "bg-danger" : "bg-warn")
        }
      />
      <span className="min-w-0 flex-1 truncate text-fg">{item.title}</span>
      <span
        className={
          "shrink-0 text-xs " + (overdue ? "font-medium text-danger" : "font-medium text-warn")
        }
      >
        {overdue ? `was due ${shortDueLabel(item.due)}` : `due ${shortDueLabel(item.due)}`}
      </span>
    </li>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs">
      <span className="text-subtle">{label}</span>
      <span className="font-medium tabular-nums text-fg">{value}</span>
    </span>
  );
}

/** The offline engine's stand-in for prose: the names themselves, plainly. */
function NameList({ label, names }: { label: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <section className="rounded-xl border border-line bg-surface px-5 py-3.5">
      <h2 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-subtle">
        {label}
      </h2>
      <p className="text-sm leading-relaxed text-fg">{names.join(" · ")}</p>
    </section>
  );
}
