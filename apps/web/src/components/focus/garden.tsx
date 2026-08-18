/**
 * The garden — one plant per day of the current week, growing with the minutes you focused.
 *
 * This is TendTo's answer to Forest's tree, with the mechanic that makes Forest work removed on
 * purpose. Forest's power comes from *loss*: leave early and your tree dies. That is also why
 * gamified focus apps get tied to guilt and streak anxiety. Here **nothing ever dies and nothing
 * is taken away** — a day you didn't focus is bare soil, not a stump, and past growth is kept in
 * the heatmap rather than destroyed. The product is called TendTo; a thing you tend, which waits
 * for you rather than punishing you, is the version of this that fits.
 *
 * Growth tracks a day's TOTAL MINUTES, not its session count, so the reward follows sustained
 * focus instead of something you could farm by starting timers.
 *
 * Drawn as inline SVG in `currentColor` — growth reads through FORM (seedling → stem → leaves →
 * bloom), not colour, so it themes correctly and stays consistent with a palette that
 * deliberately has no hues.
 */
import { intensity, type DayTotal } from "../../lib/focus/stats";
import { formatMinutes } from "../../lib/focus/stats";

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"] as const;

interface GardenProps {
  /** Seven day totals, Sunday first. */
  week: DayTotal[];
  /** Today's local date key, so the current day can be marked. */
  todayKey: string;
}

export function Garden({ week, todayKey }: GardenProps) {
  return (
    <div data-testid="focus-garden" className="w-full">
      <div className="flex items-end justify-between gap-1">
        {week.map((day, index) => (
          <div key={day.dateKey} className="flex min-w-0 flex-1 flex-col items-center">
            <Plant
              stage={intensity(day.minutes)}
              label={`${day.dateKey}: ${formatMinutes(day.minutes)} focused`}
            />
            <span
              className={
                "mt-1 text-[10px] " +
                (day.dateKey === todayKey ? "font-medium text-fg" : "text-subtle")
              }
            >
              {WEEKDAY_INITIALS[index]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One day's plant. Stage 0 is bare soil — the honest representation of a day you didn't focus,
 * and deliberately not a dead or wilted plant.
 */
function Plant({ stage, label }: { stage: 0 | 1 | 2 | 3 | 4; label: string }) {
  return (
    <svg
      viewBox="0 0 24 40"
      role="img"
      aria-label={label}
      data-stage={stage}
      className="h-12 w-full max-w-[2.5rem] text-accent"
    >
      {/* Soil line: always present, so an empty day still reads as ground waiting, not absence. */}
      <line
        x1="3"
        y1="37"
        x2="21"
        y2="37"
        stroke="currentColor"
        strokeOpacity={0.25}
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {stage >= 1 ? (
        <path
          d="M12 37 V30"
          stroke="currentColor"
          strokeOpacity={0.5}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ) : null}
      {stage >= 1 ? <circle cx="12" cy="28.5" r="1.8" fill="currentColor" fillOpacity={0.5} /> : null}

      {stage >= 2 ? (
        <path
          d="M12 30 V21"
          stroke="currentColor"
          strokeOpacity={0.7}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ) : null}
      {stage >= 2 ? (
        <path
          d="M12 25 C8 24 6.5 21.5 6.5 19.5 C9 19.5 11.2 21.5 12 25 Z"
          fill="currentColor"
          fillOpacity={0.55}
        />
      ) : null}

      {stage >= 3 ? (
        <path
          d="M12 21 V14"
          stroke="currentColor"
          strokeOpacity={0.85}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ) : null}
      {stage >= 3 ? (
        <path
          d="M12 19 C16 18 17.5 15.5 17.5 13.5 C15 13.5 12.8 15.5 12 19 Z"
          fill="currentColor"
          fillOpacity={0.7}
        />
      ) : null}

      {stage >= 4 ? (
        <>
          <circle cx="12" cy="10" r="3.6" fill="currentColor" />
          <circle cx="12" cy="10" r="1.4" className="text-app" fill="currentColor" />
        </>
      ) : null}
    </svg>
  );
}
