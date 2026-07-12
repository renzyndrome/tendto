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
  tasks: FocusTask[];

  start: () => void;
  pause: () => void;
  reset: () => void;
  completePhase: () => void;
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

      completePhase: () =>
        set((s) => {
          const nextPhase: FocusPhase = s.phase === "work" ? "break" : "work";
          return {
            phase: nextPhase,
            completed: s.phase === "work" ? s.completed + 1 : s.completed,
            running: true,
            endsAt: Date.now() + phaseSeconds(s, nextPhase) * 1000,
            pausedRemaining: 0,
          };
        }),

      setDurations: (workMin, breakMin) =>
        set((s) => {
          const w = clampMinutes(workMin);
          const b = clampMinutes(breakMin);
          // If idle on a fresh phase, reflect the new duration immediately.
          const pausedRemaining =
            !s.running && s.phase === "work" ? w * 60 : s.pausedRemaining;
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

/** Seconds left right now (derived from `endsAt` while running, else the paused value). */
export function remainingSeconds(s: FocusState): number {
  if (s.running && s.endsAt !== null) return Math.max(0, Math.round((s.endsAt - Date.now()) / 1000));
  return s.pausedRemaining;
}

function clampMinutes(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(120, Math.max(1, Math.round(n)));
}
