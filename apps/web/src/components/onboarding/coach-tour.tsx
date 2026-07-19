/**
 * Coach-mark tour (2c) — a 4-step spotlight over real UI. Each step highlights a live element
 * (found by `[data-tour]`), dims everything else with the classic huge-box-shadow technique, and
 * anchors a dark tooltip beside it. Back / Skip / Next; completion is remembered so it never
 * auto-shows again. If a target isn't on screen, the tooltip centers gracefully.
 */
import { useLayoutEffect, useState } from "react";

import { TOUR_STEPS, useOnboardingStore } from "../../stores/onboarding";

type Placement = "bottom" | "top" | "right";

interface Step {
  target: string; // [data-tour="…"] value
  title: string;
  body: React.ReactNode;
  placement: Placement;
}

const STEPS: Step[] = [
  {
    target: "search",
    title: "Jump anywhere",
    body: (
      <>
        Press <TourKbd>⌘K</TourKbd> to find or create any page in an instant.
      </>
    ),
    placement: "bottom",
  },
  {
    target: "canvas",
    title: "Everything is a block",
    body: (
      <>
        Type <TourKbd>/</TourKbd> anywhere to insert headings, to-dos, toggles, boards or code.
      </>
    ),
    placement: "right",
  },
  {
    target: "new-page",
    title: "Start a page",
    body: <>Add a page or subpage from the sidebar — it saves the moment you type.</>,
    placement: "right",
  },
  {
    target: "sync",
    title: "Synced, quietly",
    body: <>Changes save on this device first and sync in the background. No spinners, no nags.</>,
    placement: "top",
  },
];

const PAD = 6;

export function CoachTour() {
  const tourStep = useOnboardingStore((s) => s.tourStep);
  const next = useOnboardingStore((s) => s.nextStep);
  const prev = useOnboardingStore((s) => s.prevStep);
  const skip = useOnboardingStore((s) => s.skipTour);

  const step = STEPS[tourStep - 1];
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (!step) return;
    function measure(): void {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step]);

  if (!step) return null;

  const spotlight = rect
    ? {
        top: rect.top - PAD,
        left: rect.left - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
      }
    : null;

  const tooltip = tooltipPosition(spotlight, step.placement);

  return (
    <div className="fixed inset-0 z-[60]">
      {/* Dim everything to a light veil (design 2c fades the canvas, not a dark overlay); cut a
          hole around the target via a large spreading shadow + the accent border/ring. */}
      {spotlight ? (
        <div
          className="pointer-events-none absolute rounded-[10px] transition-all duration-150"
          style={{
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
            boxShadow:
              "0 0 0 9999px rgba(31,29,24,.28), 0 0 0 1.5px var(--accent), 0 0 0 5px var(--accent-ring)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-[rgba(31,29,24,.28)]" />
      )}

      {/* Tooltip */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={step.title}
        className="absolute w-[300px] max-w-[calc(100vw-24px)] animate-pop-in rounded-[12px] bg-tooltip p-[18px] text-tooltip-text shadow-tooltip"
        style={tooltip}
      >
        <div
          className="text-[10.5px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: "oklch(0.75 0.1 var(--accent-hue))" }}
        >
          Step {tourStep} of {TOUR_STEPS}
        </div>
        <div className="mt-1.5 text-sm font-semibold">{step.title}</div>
        <div className="mt-1 text-[12.5px] leading-[1.55] text-[#b8b3a6]">{step.body}</div>
        <div className="mt-3.5 flex items-center">
          <button
            type="button"
            onClick={prev}
            disabled={tourStep === 1}
            className="text-[12px] text-[#8a857a] hover:text-tooltip-text disabled:opacity-0"
          >
            Back
          </button>
          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              onClick={skip}
              className="text-[12px] text-[#8a857a] hover:text-tooltip-text"
            >
              Skip tour
            </button>
            <button
              type="button"
              onClick={next}
              className="rounded-row bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-accent-contrast hover:bg-accent-hover"
            >
              {tourStep === TOUR_STEPS ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TourKbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-white/15 px-1.5 py-0.5 font-mono text-[11px]">{children}</span>
  );
}

/** Position the 300px tooltip near the spotlight, clamped to the viewport; center if no target. */
function tooltipPosition(
  spot: { top: number; left: number; width: number; height: number } | null,
  placement: Placement,
): React.CSSProperties {
  const W = 300;
  const GAP = 12;
  if (!spot) {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }
  const clampLeft = (x: number): number => Math.max(12, Math.min(x, window.innerWidth - W - 12));
  if (placement === "bottom") {
    return { top: spot.top + spot.height + GAP, left: clampLeft(spot.left) };
  }
  if (placement === "top") {
    return { top: Math.max(12, spot.top - GAP - 150), left: clampLeft(spot.left) };
  }
  // right
  return {
    top: Math.max(12, spot.top),
    left: clampLeft(spot.left + spot.width + GAP),
  };
}
