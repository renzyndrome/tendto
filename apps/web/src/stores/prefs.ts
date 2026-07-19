/**
 * Appearance preferences store (Zustand + persist).
 *
 * Per device: persisted to localStorage and applied live to :root on every change. This is a UI
 * preference object, not synced content — it deliberately does NOT live in the PowerSync replica.
 * (Cross-device sync of preferences would need a synced `user_settings` table — see docs; the
 * design's "synced to your other devices" is a future upgrade. Local apply is instant + offline.)
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { applyTheme } from "../lib/prefs/apply-theme";
import { PREFS_STORAGE_KEY } from "../lib/prefs/apply-theme";
import { DEFAULT_PREFERENCES, type Preferences } from "../lib/prefs/types";

interface PrefsState {
  prefs: Preferences;
  setPref: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  resetPrefs: () => void;
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set, get) => ({
      prefs: DEFAULT_PREFERENCES,
      setPref: (key, value) => {
        const next = { ...get().prefs, [key]: value };
        set({ prefs: next });
        applyTheme(next);
      },
      resetPrefs: () => {
        set({ prefs: DEFAULT_PREFERENCES });
        applyTheme(DEFAULT_PREFERENCES);
      },
    }),
    {
      name: PREFS_STORAGE_KEY,
      partialize: (state) => ({ prefs: state.prefs }),
      onRehydrateStorage: () => (state) => {
        // Re-assert the theme once the persisted value is loaded (covers the async rehydrate path).
        if (state) applyTheme(state.prefs);
      },
    },
  ),
);
