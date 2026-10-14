/**
 * "Own API key" in Personalization > AI: a provider, a model and a key, kept on the server and
 * used for this user's AI requests in place of the server's engine (lib/ai/own-key.ts).
 *
 * Writes at once, like a template action, rather than waiting for the dialog's Save: the key is
 * account data on the server, not a device setting. The key field is a password field and is
 * never filled back in; a stored key shows as its last four characters. The fields stay closed
 * until the row is opened (ai-setup.tsx).
 */
import { useEffect, useState } from "react";

import {
  CUSTOM_PROVIDER,
  loadOwnKey,
  removeOwnKey,
  saveOwnKey,
  type OwnKeySettings,
} from "../../lib/ai/own-key";
import { SetupRow } from "./ai-setup";

type Load = { state: "loading" } | { state: "failed" } | { state: "ready"; data: OwnKeySettings };

export function OwnKeyForm() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadOwnKey()
      .then((data) => {
        if (!cancelled) setLoad({ state: "ready", data });
      })
      .catch(() => {
        if (!cancelled) setLoad({ state: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (load.state !== "ready") {
    return (
      <SetupRow
        label="Own API key"
        testid="own-key"
        summary={load.state === "loading" ? "Checking…" : "Unavailable offline."}
      >
        {null}
      </SetupRow>
    );
  }

  const { data } = load;
  if (!data.enabled) {
    return (
      <SetupRow
        label="Own API key"
        testid="own-key"
        summary="Disabled on this server. Set AI_KEYS_SECRET (32+ characters) to enable."
      >
        {null}
      </SetupRow>
    );
  }

  async function remove(): Promise<void> {
    setMessage(null);
    try {
      await removeOwnKey();
      setLoad({ state: "ready", data: { ...data, configured: false, key_hint: null } });
      setEditing(false);
      setMessage("Key removed.");
    } catch {
      setMessage("Key not removed. Retry.");
    }
  }

  const providerLabel =
    data.providers.find((provider) => provider.key === data.provider)?.label ?? data.provider;
  const usable = data.configured && data.key_readable;
  // What is set up, shown whether the row is open or closed. Never a field: those wait for a
  // click, so nothing asks for a key before someone chose to add one.
  const summary = usable
    ? `${providerLabel} · ${data.model} · key ${data.key_hint}`
    : data.configured
      ? "Stored key unreadable. AI off until it is entered again."
      : null;

  return (
    <SetupRow label="Own API key" testid="own-key" summary={summary}>
      {usable && !editing ? (
        <div className="flex gap-1">
          <SmallButton onClick={() => setEditing(true)}>Change</SmallButton>
          <SmallButton onClick={() => void remove()}>Remove key</SmallButton>
        </div>
      ) : (
        <KeyFields
          data={data}
          onCancel={usable ? () => setEditing(false) : undefined}
          onSaved={(next) => {
            setLoad({ state: "ready", data: next });
            setEditing(false);
            setMessage("Key saved.");
          }}
        />
      )}
      {message ? (
        <p role="status" className="text-xs text-subtle">
          {message}
        </p>
      ) : null}
    </SetupRow>
  );
}

function KeyFields({
  data,
  onCancel,
  onSaved,
}: {
  data: OwnKeySettings;
  onCancel?: () => void;
  onSaved: (next: OwnKeySettings) => void;
}) {
  const [provider, setProvider] = useState(data.provider ?? data.providers[0]?.key ?? "");
  const [model, setModel] = useState(data.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(data.base_url ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultModel = data.providers.find((option) => option.key === provider)?.default_model;
  // The stored key is kept on an empty field only while the provider stays the same.
  const keepsKey = data.configured && data.key_readable && provider === data.provider;

  async function submit(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      onSaved(await saveOwnKey({ provider, model, api_key: apiKey, base_url: baseUrl }));
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : "Key not saved. Retry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="grid grid-cols-2 gap-1">
        {data.providers.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setProvider(option.key)}
            aria-pressed={provider === option.key}
            data-testid={`own-key-provider-${option.key}`}
            className={`rounded border px-2 py-1.5 text-sm ${
              provider === option.key
                ? "border-fg bg-hover text-fg"
                : "border-line text-muted hover:bg-hover hover:text-fg"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {provider === CUSTOM_PROVIDER ? (
        <TextField
          label="Base URL"
          value={baseUrl}
          onChange={setBaseUrl}
          placeholder="https://…/v1"
        />
      ) : null}
      <TextField
        label="Model"
        value={model}
        onChange={setModel}
        placeholder={defaultModel || "Model name"}
      />
      <TextField
        label="API key"
        value={apiKey}
        onChange={setApiKey}
        type="password"
        placeholder={keepsKey ? "Empty keeps the stored key" : "Key from the provider"}
      />
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex gap-1">
        <button
          type="submit"
          disabled={saving || (!apiKey.trim() && !keepsKey)}
          data-testid="own-key-save"
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
        >
          Save key
        </button>
        {onCancel ? <SmallButton onClick={onCancel}>Cancel</SmallButton> : null}
      </div>
    </form>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password";
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-subtle">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded border border-line bg-app px-2 py-1 text-sm text-fg outline-none placeholder:text-subtle focus:border-muted"
      />
    </label>
  );
}

function SmallButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-line px-2 py-1 text-xs text-muted hover:bg-hover hover:text-fg"
    >
      {children}
    </button>
  );
}
