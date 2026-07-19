/**
 * Settings (1d) — a section nav + body. Appearance is the lead panel: Mode, Accent, Document type,
 * Density, Editor width, each wired to the per-device prefs store and applied live to :root. Account
 * and Import/export host the sign-out + workspace export that used to live in the sidebar footer.
 */
import { useState } from "react";

import { signOut, useSession } from "../../lib/auth/client";
import { clearAuthToken } from "../../lib/auth/token";
import { exportWorkspace } from "../../lib/export";
import { db } from "../../lib/powersync/client";
import { ACCENT_SWATCHES, type Accent, type Mode } from "../../lib/prefs/types";
import { useOnboardingStore } from "../../stores/onboarding";
import { usePrefsStore } from "../../stores/prefs";
import { useUiStore } from "../../stores/ui";
import { TopBar } from "../layout/top-bar";
import { Icon } from "../ui/icon";
import { SegmentedControl } from "../ui/segmented";

type Section = "account" | "appearance" | "sync" | "shortcuts" | "import-export";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "appearance", label: "Appearance" },
  { id: "sync", label: "Sync & storage" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "import-export", label: "Import / export" },
];

export function SettingsView() {
  const [section, setSection] = useState<Section>("appearance");

  return (
    <div className="flex h-full flex-col">
      <TopBar
        crumbs={[
          { label: "Settings" },
          { label: SECTIONS.find((s) => s.id === section)?.label ?? "Appearance" },
        ]}
      />
      <div className="flex min-h-0 flex-1">
        {/* Section nav */}
        <nav className="hidden w-[190px] shrink-0 border-r border-hairline bg-panel px-2 py-4 sm:block">
          <div className="px-2.5 pb-3 text-sm font-semibold text-ink">Settings</div>
          <div className="space-y-px">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                className={
                  "w-full rounded-row px-2.5 py-1.5 text-left text-[12.5px] " +
                  (s.id === section
                    ? "bg-accent-soft font-medium text-accent-soft-text"
                    : "text-secondary row-hover")
                }
              >
                {s.label}
              </button>
            ))}
          </div>
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-6 py-7 md:px-8">
            {section === "appearance" ? (
              <AppearancePanel />
            ) : section === "account" ? (
              <AccountPanel />
            ) : section === "import-export" ? (
              <ImportExportPanel />
            ) : section === "sync" ? (
              <SyncPanel />
            ) : (
              <ShortcutsPanel />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- Appearance -------------------------------- */

function AppearancePanel() {
  const prefs = usePrefsStore((s) => s.prefs);
  const setPref = usePrefsStore((s) => s.setPref);

  return (
    <section>
      <h1 className="text-lg font-semibold tracking-[-0.01em] text-ink">Appearance</h1>
      <p className="mt-1 text-[12.5px] text-muted">Applies on this device instantly.</p>

      <FieldLabel>Mode</FieldLabel>
      <div className="flex gap-2.5">
        {(["light", "dark", "system"] as Mode[]).map((mode) => (
          <ModeCard
            key={mode}
            mode={mode}
            selected={prefs.mode === mode}
            onSelect={() => setPref("mode", mode)}
          />
        ))}
      </div>

      <FieldLabel>Accent</FieldLabel>
      <div className="flex items-center gap-3">
        {ACCENT_SWATCHES.map((swatch) => (
          <button
            key={swatch.id}
            type="button"
            aria-label={swatch.label}
            aria-pressed={prefs.accent === swatch.id}
            onClick={() => setPref("accent", swatch.id as Accent)}
            style={{
              background: swatch.color,
              outline: prefs.accent === swatch.id ? "2px solid var(--ink)" : "none",
              outlineOffset: "3px",
            }}
            className="h-7 w-7 rounded-full"
          />
        ))}
        <span className="ml-1 text-[12px] text-muted">
          {ACCENT_SWATCHES.find((s) => s.id === prefs.accent)?.label}
        </span>
      </div>

      <FieldLabel>Document type</FieldLabel>
      <div className="flex gap-2.5">
        <DocTypeCard
          font="sans"
          label="Sans"
          className="font-sans"
          selected={prefs.docFont === "sans"}
          onSelect={() => setPref("docFont", "sans")}
        />
        <DocTypeCard
          font="serif"
          label="Serif"
          className="font-serif"
          selected={prefs.docFont === "serif"}
          onSelect={() => setPref("docFont", "serif")}
        />
        <DocTypeCard
          font="mono"
          label="Mono"
          className="font-mono"
          selected={prefs.docFont === "mono"}
          onSelect={() => setPref("docFont", "mono")}
        />
      </div>

      <div className="mt-6 flex flex-wrap gap-8">
        <div>
          <FieldLabel className="mt-0">Density</FieldLabel>
          <SegmentedControl
            ariaLabel="Density"
            value={prefs.density}
            onChange={(v) => setPref("density", v)}
            options={[
              { value: "comfortable", label: "Comfortable" },
              { value: "compact", label: "Compact" },
            ]}
          />
        </div>
        <div>
          <FieldLabel className="mt-0">Editor width</FieldLabel>
          <SegmentedControl
            ariaLabel="Editor width"
            value={prefs.editorWidth}
            onChange={(v) => setPref("editorWidth", v)}
            options={[
              { value: "narrow", label: "Narrow" },
              { value: "full", label: "Full" },
            ]}
          />
        </div>
      </div>
    </section>
  );
}

function FieldLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={"mb-2.5 mt-6 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint " + className}>
      {children}
    </div>
  );
}

function ModeCard({
  mode,
  selected,
  onSelect,
}: {
  mode: Mode;
  selected: boolean;
  onSelect: () => void;
}) {
  const label = mode === "light" ? "Light" : mode === "dark" ? "Dark" : "System";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        "flex-1 overflow-hidden rounded-card border text-left transition-colors " +
        (selected ? "border-2 border-accent" : "border border-hairline-strong hover:border-border-hover")
      }
    >
      <div className="h-[52px] p-2">
        {mode === "light" ? (
          <MiniSkeleton bg="#fbfaf7" bars={["#d9d4c8", "#e8e4da"]} />
        ) : mode === "dark" ? (
          <MiniSkeleton bg="#23211c" bars={["#4a463d", "#37342d"]} />
        ) : (
          <div className="h-full rounded-[3px]" style={{ background: "linear-gradient(110deg,#fbfaf7 50%,#23211c 50%)" }}>
            <div className="h-1.5 w-3/5 rounded-[3px]" style={{ background: "#b8b3a6" }} />
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 px-2.5 py-[7px] text-xs">
        {selected ? <span className="h-1.5 w-1.5 rounded-full bg-accent" /> : null}
        <span className={selected ? "font-medium text-ink" : "text-secondary"}>{label}</span>
      </div>
    </button>
  );
}

function MiniSkeleton({ bg, bars }: { bg: string; bars: string[] }) {
  return (
    <div className="h-full rounded-[3px] p-1.5" style={{ background: bg }}>
      <div className="h-1.5 w-3/5 rounded-[3px]" style={{ background: bars[0] }} />
      <div className="mt-1 h-1.5 w-4/5 rounded-[3px]" style={{ background: bars[1] }} />
    </div>
  );
}

function DocTypeCard({
  label,
  className,
  selected,
  onSelect,
}: {
  font: string;
  label: string;
  className: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        "flex-1 rounded-card px-3.5 py-3 text-left transition-colors " +
        (selected ? "border-2 border-accent" : "border border-hairline-strong hover:border-border-hover")
      }
    >
      <div className={"text-xl font-semibold text-ink " + className}>Ag</div>
      <div className="mt-1 text-[11.5px] text-muted">{label}</div>
    </button>
  );
}

/* ---------------------------------- Account ---------------------------------- */

function AccountPanel() {
  const { data: session } = useSession();
  const email = session?.user?.email ?? "—";
  const replayTour = useOnboardingStore((s) => s.resetOnboarding);

  async function handleSignOut(): Promise<void> {
    await signOut();
    clearAuthToken();
    try {
      // Clear the local replica (data + upload queue), not just disconnect — otherwise the next
      // user to sign in on this device inherits this account's queued writes, which then fail
      // (403) against workspaces they don't belong to and wedge the sync queue.
      await db.disconnectAndClear();
    } catch {
      // already disconnected — ignore
    }
    // A hard reload guarantees a clean in-memory state for the next sign-in.
    window.location.href = "/";
  }

  return (
    <section>
      <h1 className="text-lg font-semibold tracking-[-0.01em] text-ink">Account</h1>
      <p className="mt-1 text-[12.5px] text-muted">Your sign-in and session.</p>

      <div className="mt-6 overflow-hidden rounded-card border border-hairline bg-surface">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-[12.5px] text-muted">Email</span>
          <span className="text-[13px] text-body">{email}</span>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void handleSignOut()}
          className="rounded-input border border-hairline-strong px-4 py-2 text-[13px] text-secondary hover:bg-btn-hover"
        >
          Sign out
        </button>
        <button
          type="button"
          onClick={replayTour}
          className="rounded-input px-4 py-2 text-[13px] text-muted hover:text-ink"
        >
          Replay welcome tour
        </button>
      </div>
    </section>
  );
}

/* ------------------------------- Import / export ----------------------------- */

function ImportExportPanel() {
  const workspaceId = useUiStore((s) => s.activeWorkspaceId);
  const [exporting, setExporting] = useState(false);

  async function handleExport(): Promise<void> {
    if (!workspaceId || exporting) return;
    setExporting(true);
    try {
      await exportWorkspace(workspaceId);
    } catch (err) {
      console.error("Workspace export failed", err);
    } finally {
      setExporting(false);
    }
  }

  return (
    <section>
      <h1 className="text-lg font-semibold tracking-[-0.01em] text-ink">Import / export</h1>
      <p className="mt-1 text-[12.5px] text-muted">
        Export your workspace as a portable archive. Your data is always local first.
      </p>
      <button
        type="button"
        onClick={() => void handleExport()}
        disabled={exporting}
        className="mt-6 flex items-center gap-2 rounded-input border border-hairline-strong px-4 py-2 text-[13px] text-secondary hover:bg-btn-hover disabled:opacity-50"
      >
        <Icon name="copy" size={15} className="text-muted" />
        {exporting ? "Exporting…" : "Export workspace"}
      </button>
    </section>
  );
}

/* --------------------------------- Sync panel -------------------------------- */

function SyncPanel() {
  return (
    <section>
      <h1 className="text-lg font-semibold tracking-[-0.01em] text-ink">Sync & storage</h1>
      <p className="mt-1 text-[12.5px] text-muted">
        TendTo saves every change to this device first, then syncs quietly in the background. No
        conflict dialogs — changes merge automatically.
      </p>
      <div className="mt-6 flex items-center gap-2 rounded-card border border-hairline bg-surface px-4 py-3">
        <span className="h-[7px] w-[7px] rounded-full bg-sync" />
        <span className="text-[13px] text-body">All changes saved · synced</span>
      </div>
    </section>
  );
}

/* ------------------------------- Shortcuts panel ----------------------------- */

function ShortcutsPanel() {
  const rows: [string, string][] = [
    ["Jump to anything", "⌘K"],
    ["Insert a block", "/"],
    ["New page", "⌘N"],
  ];
  return (
    <section>
      <h1 className="text-lg font-semibold tracking-[-0.01em] text-ink">Shortcuts</h1>
      <div className="mt-6 overflow-hidden rounded-card border border-hairline bg-surface">
        {rows.map(([label, key]) => (
          <div
            key={label}
            className="flex items-center justify-between border-b border-hairline px-4 py-2.5 last:border-b-0"
          >
            <span className="text-[13px] text-body">{label}</span>
            <span className="kbd">{key}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
