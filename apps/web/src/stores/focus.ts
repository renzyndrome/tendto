/**
 * Focus mode — a Pomodoro timer + an in-session task list. This is device-local UI state (not
 * synced content): it persists to localStorage so a reload mid-session doesn't lose the timer or
 * your task list. The countdown is derived from `endsAt` (a timestamp), so it keeps ticking
 * correctly across reloads and navigation.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type FocusPhase = "work" | "break";

export interface FocusTask {
  id: string;
  text: string;
  done: boolean;
}

interface FocusState {
  phase: FocusPhase;
  running: boolean;
  endsAt: number | null; // epoch ms the current phase ends (while running)
  pausedRemaining: number; // seconds left while paused
  completed: number; // completed work sessions
  workMin: number;
  breakMin: number;
  /**
   * Whether a finished phase rolls straight into the next one. OFF by default: a timer that
   * restarts itself has decided for you that you're ready, and a break you didn't notice
   * starting is a break you didn't take.
   */
  autoContinue: boolean;
  tasks: FocusTask[];

  start: () => void;
  pause: () => void;
  reset: () => void;
  completePhase: () => void;
  setAutoContinue: (on: boolean) => void;
  setDurations: (workMin: number, breakMin: number) => void;
  addTask: (text: string) => void;
  toggleTask: (id: string) => void;
  removeTask: (id: string) => void;
  clearDone: () => void;
}

const DEFAULT_WORK = 25;
const DEFAULT_BREAK = 5;

export const useFocusStore = create<FocusState>()(
  persist(
    (set) => ({
      phase: "work",
      running: false,
      endsAt: null,
      pausedRemaining: DEFAULT_WORK * 60,
      completed: 0,
      workMin: DEFAULT_WORK,
      breakMin: DEFAULT_BREAK,
      autoContinue: false,
      tasks: [],

      start: () =>
        set((s) => {
          const secs = s.pausedRemaining > 0 ? s.pausedRemaining : phaseSeconds(s, s.phase);
          return { running: true, endsAt: Date.now() + secs * 1000 };
        }),

      pause: () =>
        set((s) => ({
          running: false,
          endsAt: null,
          pausedRemaining: remainingSeconds(s),
        })),

      reset: () =>
        set((s) => ({
          phase: "work",
          running: false,
          endsAt: null,
          pausedRemaining: s.workMin * 60,
        })),

      /**
       * A phase ran out: move to the next one, but only START it when auto-continue is on.
       * Otherwise the next phase sits armed at its full duration, waiting for Start.
       */
      completePhase: () =>
        set((s) => {
          const nextPhase: FocusPhase = s.phase === "work" ? "break" : "work";
          const seconds = phaseSeconds(s, nextPhase);
          return {
            phase: nextPhase,
            completed: s.phase === "work" ? s.completed + 1 : s.completed,
            running: s.autoContinue,
            endsAt: s.autoContinue ? Date.now() + seconds * 1000 : null,
            pausedRemaining: s.autoContinue ? 0 : seconds,
          };
        }),

      setAutoContinue: (on) => set({ autoContinue: on }),

      setDurations: (workMin, breakMin) =>
        set((s) => {
          const w = clampMinutes(workMin);
          const b = clampMinutes(breakMin);
          // If the phase is idle at its full duration there is nothing to resume, so reflect the
          // new number now rather than at the next phase — including a break waiting to be started.
          const pausedRemaining = isFresh(s)
            ? phaseSeconds({ workMin: w, breakMin: b }, s.phase)
            : s.pausedRemaining;
          return { workMin: w, breakMin: b, pausedRemaining };
        }),

      addTask: (text) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        set((s) => ({
          tasks: [...s.tasks, { id: crypto.randomUUID(), text: trimmed, done: false }],
        }));
      },

      toggleTask: (id) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
        })),

      removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),

      clearDone: () => set((s) => ({ tasks: s.tasks.filter((t) => !t.done) })),
    }),
    { name: "tendto-focus" },
  ),
);

function phaseSeconds(s: Pick<FocusState, "workMin" | "breakMin">, phase: FocusPhase): number {
  return (phase === "work" ? s.workMin : s.breakMin) * 60;
}

/**
 * True when the phase is idle at its full duration — i.e. it would be Started, not Resumed.
 * Takes the durations separately so `setDurations` can ask about a phase it's about to change.
 */
export function isFresh(s: Pick<FocusState, "running" | "pausedRemaining" | "phase" | "workMin" | "breakMin">): boolean {
  return !s.running && s.pausedRemaining >= phaseSeconds(s, s.phase);
}

/** Seconds left right now (derived from `endsAt` while running, else the paused value). */
export function remainingSeconds(s: FocusState): number {
  if (s.running && s.endsAt !== null) return Math.max(0, Math.round((s.endsAt - Date.now()) / 1000));
  return s.pausedRemaining;
}

function clampMinutes(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(120, Math.max(1, Math.round(n)));
}
