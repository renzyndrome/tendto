/**
 * Focus mode — a Pomodoro timer plus an in-session task list. Opt-in surface (you navigate here),
 * so it stays out of the way until you want it. State lives in the local focus store (persisted).
 */
import { useEffect, useReducer, useState } from "react";

import { notify } from "../../lib/notifications";
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

  // Advance to the next phase when the countdown reaches zero, and say so — the whole point of
  // a Pomodoro is that you're looking elsewhere when it ends. Its own tag keeps it separate
  // from due reminders (see lib/notifications.ts).
  useEffect(() => {
    if (!store.running || remaining > 0) return;
    const finished = store.phase;
    notify(finished === "work" ? "Focus session complete" : "Break over", {
      body:
        finished === "work"
          ? `Time for a ${store.breakMin} minute break.`
          : `Back to it — ${store.workMin} minutes of focus.`,
      tag: "tendto-pomodoro",
    });
    store.completePhase();
  }, [store, remaining]);

  const remainingTasks = store.tasks.filter((t) => !t.done).length;

  function addFromDraft() {
    store.addTask(draft);
    setDraft("");
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center px-6 py-12">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-subtle">
        {store.phase === "work" ? "Focus" : "Break"}
      </div>
      <div
        data-testid="focus-timer"
        className="mb-5 text-6xl font-semibold tabular-nums text-fg"
      >
        {mmss(remaining)}
      </div>

      <div className="mb-6 flex items-center gap-2">
        {store.running ? (
          <button
            type="button"
            onClick={() => store.pause()}
            className="rounded-md bg-accent px-5 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
          >
            Pause
          </button>
        ) : (
          <button
            type="button"
            onClick={() => store.start()}
            className="rounded-md bg-accent px-5 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
          >
            Start
          </button>
        )}
        <button
          type="button"
          onClick={() => store.reset()}
          className="rounded-md px-4 py-1.5 text-sm text-muted hover:bg-hover hover:text-fg"
        >
          Reset
        </button>
      </div>

      <div className="mb-8 flex items-center gap-4 text-xs text-muted">
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
            className="w-12 rounded border border-line px-1 py-0.5 text-center"
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
            className="w-12 rounded border border-line px-1 py-0.5 text-center"
          />
          min
        </label>
      </div>

      <div className="w-full">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-muted">This session</span>
          {store.tasks.some((t) => t.done) ? (
            <button
              type="button"
              onClick={() => store.clearDone()}
              className="text-xs text-subtle hover:text-fg"
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
            className="flex-1 rounded-md border border-line px-3 py-1.5 text-sm outline-none focus:border-fg"
          />
          <button
            type="button"
            onClick={addFromDraft}
            className="rounded-md bg-accent px-3 text-sm text-on-accent hover:opacity-90"
          >
            Add
          </button>
        </div>

        <ul data-testid="focus-tasks" className="space-y-0.5">
          {store.tasks.map((task) => (
            <li
              key={task.id}
              className="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-hover/40"
            >
              <input
                type="checkbox"
                checked={task.done}
                onChange={() => store.toggleTask(task.id)}
                className="h-4 w-4 shrink-0 rounded border-line"
                aria-label={task.done ? "Mark not done" : "Mark done"}
              />
              <span
                className={
                  "flex-1 text-sm " + (task.done ? "text-subtle line-through" : "text-fg")
                }
              >
                {task.text}
              </span>
              <button
                type="button"
                onClick={() => store.removeTask(task.id)}
                aria-label="Remove task"
                className="invisible shrink-0 text-subtle hover:text-danger group-hover:visible"
              >
                ×
              </button>
            </li>
          ))}
          {store.tasks.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-subtle">
              No tasks yet — add a few to focus on.
            </li>
          ) : null}
        </ul>
        {store.tasks.length > 0 ? (
          <p className="mt-2 text-xs text-subtle">{remainingTasks} left</p>
        ) : null}
      </div>
    </div>
  );
}
