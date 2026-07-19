/**
 * Focus mode — a Pomodoro timer plus an in-session task list. Opt-in surface (you navigate here),
 * so it stays out of the way until you want it. State lives in the local focus store (persisted).
 */
import { useEffect, useReducer, useState } from "react";

import { notifyPhaseEnded } from "../../lib/desktop/notify";
import { remainingSeconds, useFocusStore } from "../../stores/focus";

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function FocusView() {
  const store = useFocusStore();
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const [draft, setDraft] = useState("");

  // Re-render ~4×/sec while running so the countdown updates; paused needs no ticker.
  useEffect(() => {
    if (!store.running) return;
    const id = setInterval(() => tick(), 250);
    return () => clearInterval(id);
  }, [store.running]);

  const remaining = remainingSeconds(store);

  // Advance to the next phase when the countdown reaches zero.
  useEffect(() => {
    if (store.running && remaining <= 0) {
      // Fire a native OS notification on the desktop shell (no-op in the browser). Capture the
      // phase that just ended before completePhase() flips it.
      void notifyPhaseEnded(store.phase);
      store.completePhase();
    }
  }, [store, remaining]);

  const remainingTasks = store.tasks.filter((t) => !t.done).length;

  function addFromDraft() {
    store.addTask(draft);
    setDraft("");
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center px-6 py-12">
      <div className="mb-1 text-section-label uppercase text-faint">
        {store.phase === "work" ? "Focus" : "Break"}
      </div>
      <div
        data-testid="focus-timer"
        className="mb-5 text-6xl font-semibold tabular-nums text-ink"
      >
        {mmss(remaining)}
      </div>

      <div className="mb-6 flex items-center gap-2">
        {store.running ? (
          <button
            type="button"
            onClick={() => store.pause()}
            className="rounded-input bg-accent px-5 py-1.5 text-sm font-medium text-accent-contrast hover:bg-accent-hover"
          >
            Pause
          </button>
        ) : (
          <button
            type="button"
            onClick={() => store.start()}
            className="rounded-input bg-accent px-5 py-1.5 text-sm font-medium text-accent-contrast hover:bg-accent-hover"
          >
            Start
          </button>
        )}
        <button
          type="button"
          onClick={() => store.reset()}
          className="rounded-input px-4 py-1.5 text-sm text-muted hover:bg-row-hover hover:text-ink"
        >
          Reset
        </button>
      </div>

      <div className="mb-8 flex items-center gap-4 text-xs text-secondary">
        <span data-testid="focus-completed">🍅 {store.completed} done</span>
        <label className="flex items-center gap-1">
          Focus
          <input
            type="number"
            min={1}
            max={120}
            value={store.workMin}
            onChange={(e) => store.setDurations(Number(e.target.value), store.breakMin)}
            aria-label="Focus minutes"
            className="w-12 rounded-input border border-border-soft bg-surface px-1 py-0.5 text-center text-ink outline-none focus:border-accent"
          />
          min
        </label>
        <label className="flex items-center gap-1">
          Break
          <input
            type="number"
            min={1}
            max={120}
            value={store.breakMin}
            onChange={(e) => store.setDurations(store.workMin, Number(e.target.value))}
            aria-label="Break minutes"
            className="w-12 rounded-input border border-border-soft bg-surface px-1 py-0.5 text-center text-ink outline-none focus:border-accent"
          />
          min
        </label>
      </div>

      <div className="w-full">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-secondary">This session</span>
          {store.tasks.some((t) => t.done) ? (
            <button
              type="button"
              onClick={() => store.clearDone()}
              className="text-xs text-muted hover:text-ink"
            >
              Clear done
            </button>
          ) : null}
        </div>

        <div className="mb-2 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addFromDraft();
            }}
            placeholder="Add a task for this session…"
            className="flex-1 rounded-input border border-border-soft bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-muted outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={addFromDraft}
            className="rounded-input bg-accent px-3 text-sm text-accent-contrast hover:bg-accent-hover"
          >
            Add
          </button>
        </div>

        <ul data-testid="focus-tasks" className="space-y-0.5">
          {store.tasks.map((task) => (
            <li
              key={task.id}
              className="group flex items-center gap-3 rounded-row px-2 py-1.5 row-hover"
            >
              <input
                type="checkbox"
                checked={task.done}
                onChange={() => store.toggleTask(task.id)}
                className="h-4 w-4 shrink-0 rounded border-chevron accent-accent"
                aria-label={task.done ? "Mark not done" : "Mark done"}
              />
              <span
                className={
                  "flex-1 text-sm " + (task.done ? "text-muted line-through" : "text-body")
                }
              >
                {task.text}
              </span>
              <button
                type="button"
                onClick={() => store.removeTask(task.id)}
                aria-label="Remove task"
                className="invisible shrink-0 text-faint hover:text-overdue group-hover:visible"
              >
                ×
              </button>
            </li>
          ))}
          {store.tasks.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-muted">
              No tasks yet — add a few to focus on.
            </li>
          ) : null}
        </ul>
        {store.tasks.length > 0 ? (
          <p className="mt-2 text-xs text-faint">{remainingTasks} left</p>
        ) : null}
      </div>
    </div>
  );
}
