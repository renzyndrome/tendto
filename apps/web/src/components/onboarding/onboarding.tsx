/**
 * Onboarding gate — shows the welcome dialog on first launch, then the coach tour once the user
 * opts in. Both read the persisted onboarding store so they never re-appear after completion.
 */
import { useOnboardingStore } from "../../stores/onboarding";
import { CoachTour } from "./coach-tour";
import { WelcomeDialog } from "./welcome-dialog";

export function Onboarding() {
  const welcomed = useOnboardingStore((s) => s.welcomed);
  const tourDone = useOnboardingStore((s) => s.tourDone);
  const tourStep = useOnboardingStore((s) => s.tourStep);

  if (!welcomed) return <WelcomeDialog />;
  if (!tourDone && tourStep > 0) return <CoachTour />;
  return null;
}
