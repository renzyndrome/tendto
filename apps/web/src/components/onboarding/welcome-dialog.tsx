/**
 * Welcome dialog (2b) — first launch only. Centered modal over a dimmed + blurred canvas,
 * three feature rows, a primary "Take the tour" and a "Skip — start writing" text action.
 * Progress dots show step 1 of 4.
 */
import { useOnboardingStore, TOUR_STEPS } from "../../stores/onboarding";
import { Kbd } from "../ui/kbd";
import { Modal } from "../ui/modal";

interface Feature {
  glyph: React.ReactNode;
  title: string;
  caption: string;
}

const FEATURES: Feature[] = [
  {
    glyph: <span className="text-[13px]">⚡</span>,
    title: "Instant, always",
    caption: "Every keystroke saves locally — works fully offline.",
  },
  {
    glyph: <Kbd className="!bg-transparent !text-accent-soft-text">⌘K</Kbd>,
    title: "Jump anywhere",
    caption: "One shortcut finds or creates any page.",
  },
  {
    glyph: <span className="text-sm font-semibold">/</span>,
    title: "Blocks on demand",
    caption: "Type / for headings, to-dos, toggles, boards and code.",
  },
];

export function WelcomeDialog() {
  const startTour = useOnboardingStore((s) => s.startTour);
  const dismissWelcome = useOnboardingStore((s) => s.dismissWelcome);

  return (
    <Modal width={440} labelledBy="welcome-title" onClose={dismissWelcome}>
      <div className="px-8 pt-8 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-[13px] bg-accent text-[21px] font-bold text-accent-contrast">
          T
        </div>
        <h2 id="welcome-title" className="mt-4 text-[21px] font-bold tracking-[-0.01em] text-ink">
          Welcome to TendTo
        </h2>
        <p className="mt-1.5 text-[13.5px] leading-[1.55] text-muted">
          Your notes live on this device first.
          <br />
          Sync happens quietly in the background.
        </p>
      </div>

      <div className="flex flex-col gap-3.5 px-8 py-5">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="flex items-start gap-3">
            <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-accent-soft-strong text-accent-soft-text">
              {feature.glyph}
            </span>
            <div>
              <div className="text-[13px] font-semibold text-ink">{feature.title}</div>
              <div className="mt-px text-[12px] text-muted">{feature.caption}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2.5 px-8 pb-6">
        <button
          type="button"
          onClick={startTour}
          className="rounded-[9px] bg-accent py-[11px] text-center text-[13.5px] font-semibold text-accent-contrast hover:bg-accent-hover"
        >
          Take the 1-minute tour
        </button>
        <button
          type="button"
          onClick={dismissWelcome}
          className="text-center text-[12.5px] text-muted hover:text-ink"
        >
          Skip — start writing
        </button>
      </div>

      <div className="flex justify-center gap-1.5 pb-[18px]">
        {Array.from({ length: TOUR_STEPS }, (_, i) => (
          <span
            key={i}
            className={
              "h-1.5 w-1.5 rounded-full " + (i === 0 ? "bg-ink" : "bg-[rgba(31,29,24,.15)]")
            }
          />
        ))}
      </div>
    </Modal>
  );
}
