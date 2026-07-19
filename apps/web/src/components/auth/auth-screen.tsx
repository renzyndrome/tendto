/**
 * Sign-in / sign-up screen — email + password with a mode toggle.
 *
 * On success, better-auth updates its session store and the top-level gate (`App`) re-renders
 * into the app shell. To keep the surface to exactly email + password, the display name is
 * derived from the email local-part on sign-up (better-auth requires a `name`).
 */
import { type FormEvent, useState } from "react";

import { signIn, signUp } from "../../lib/auth/client";

type Mode = "sign-in" | "sign-up";

function messageFrom(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return fallback;
}

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isSignUp = mode === "sign-up";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (isSignUp) {
        const { error: signUpError } = await signUp.email({
          email,
          password,
          name: email.split("@")[0] || email,
        });
        if (signUpError) throw new Error(messageFrom(signUpError, "Could not create account"));
      } else {
        const { error: signInError } = await signIn.email({ email, password });
        if (signInError) throw new Error(messageFrom(signInError, "Could not sign in"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-input border border-border-soft bg-surface px-3 py-2 text-sm text-ink " +
    "placeholder:text-muted outline-none focus:border-accent";

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-[13px] bg-accent text-lg font-bold text-accent-contrast">
            T
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">TendTo</h1>
          <p className="mt-1 text-sm text-muted">
            {isSignUp ? "Create your account" : "Welcome back"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
          <input
            type="password"
            required
            minLength={8}
            autoComplete={isSignUp ? "new-password" : "current-password"}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
          {error ? <p className="text-sm text-overdue">{error}</p> : null}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-input bg-accent px-3 py-2 text-sm font-medium text-accent-contrast transition hover:bg-accent-hover disabled:opacity-50"
          >
            {submitting ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(isSignUp ? "sign-in" : "sign-up");
            setError(null);
          }}
          className="mt-4 w-full text-center text-sm text-muted hover:text-ink"
        >
          {isSignUp ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>
      </div>
    </div>
  );
}
