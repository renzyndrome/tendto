/**
 * First-run onboarding state (Zustand + persist).
 *
 * `welcomed` gates the welcome dialog (first launch only); the coach-mark tour runs steps 1..N
 * while `tourStep > 0` and stops once `tourDone` is set. Persisted per device so it never
 * re-shows. UI-only — not synced content.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const TOUR_STEPS = 4;

interface OnboardingState {
  welcomed: boolean; // welcome dialog dismissed or actioned
  tourDone: boolean; // tour completed or skipped
  tourStep: number; // 0 = inactive; 1..TOUR_STEPS while running

  startTour: () => void; // from the welcome dialog's "Take the tour"
  nextStep: () => void;
  prevStep: () => void;
  skipTour: () => void; // ends the tour, marks onboarding complete
  completeTour: () => void;
  dismissWelcome: () => void; // "Skip — start writing"
  resetOnboarding: () => void; // test / "replay tour"
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      welcomed: false,
      tourDone: false,
      tourStep: 0,

      startTour: () => set({ welcomed: true, tourStep: 1 }),
      nextStep: () => {
        const next = get().tourStep + 1;
        if (next > TOUR_STEPS) set({ tourStep: 0, tourDone: true });
        else set({ tourStep: next });
      },
      prevStep: () => set({ tourStep: Math.max(1, get().tourStep - 1) }),
      skipTour: () => set({ welcomed: true, tourDone: true, tourStep: 0 }),
      completeTour: () => set({ welcomed: true, tourDone: true, tourStep: 0 }),
      dismissWelcome: () => set({ welcomed: true }),
      resetOnboarding: () => set({ welcomed: false, tourDone: false, tourStep: 0 }),
    }),
    { name: "tendto:onboarding" },
  ),
);
