---
name: pomodoro-phases
description: Why the Pomodoro stops between phases by default, and the StrictMode double-fire that skipped a whole phase
metadata:
  type: project
---

Added 2026-08-17, after Renzy reported the timer "is continuous on the 5mins break and 25mins
again" and asked for a manual start unless a toggle says otherwise.

## Stopping between phases is the default; Auto is the opt-in

`completePhase()` used to hard-code `running: true`, so the timer rolled work → break → work
forever. Now it advances the phase but only *arms* it — `running: autoContinue`, with
`pausedRemaining` set to the next phase's full duration so Start resumes correctly. `autoContinue`
defaults to **false**: a timer that restarts itself has decided for you that you're ready, and a
break you never noticed starting is a break you didn't take.

The Start button names the phase ("Start focus" / "Start break", "Resume" mid-phase) because that
is the whole point of stopping — you should have to agree to the break, not discover it half over.
`isFresh()` in the store is what distinguishes armed-at-full-duration from paused-mid-phase; it is
also what lets `setDurations` update an idle *break*, which the old `phase === "work"` check missed.

No migration needed for the new field: zustand's `persist` shallow-merges over the initial state,
so an existing `tendto-focus` blob without `autoContinue` simply picks up the default.

## StrictMode runs an effect's setup TWICE in one commit — with the same closure

Surfacing the manual path exposed a pre-existing bug. The phase-completion effect guarded on
`store.running`, which is exactly the value React's StrictMode remount replays: it runs
setup → cleanup → setup inside a single commit, so no re-render happens in between and the second
pass still sees `running: true, remaining: 0`. `completePhase()` therefore fired twice on one
boundary — work → break → work instantly, plus two notifications.

This is invisible in a production build (no StrictMode) and it was invisible in tests, because the
old auto-continue behaviour looked the same either way and the notification assertion only checked
`> 0`. The fix is a **ref keyed on the `endsAt` being consumed** — refs survive the simulated
remount, `running` does not. Guarding a "fire once when X happens" effect on state that the
replayed closure still holds is never enough.

`e2e/notifications.spec.ts` now asserts **exactly one** Pomodoro notification per boundary, and
`e2e/focus.spec.ts` asserts the break is armed at 05:00 and stays there. Both fail on the old code.
Same family as the `/bootstrap` duplicate-workspace race in [[workspace-creation]]: StrictMode
double-invocation is the recurring hazard in this codebase, not an edge case.

## Testing a phase boundary without waiting 25 minutes

Write the persisted store (`tendto-focus`, `{ state, version: 0 }`) with `endsAt` already in the
past, then reload — the completion effect runs when the view mounts and finds the countdown at
zero. A partial `state` is fine, since missing keys fall back to defaults.
