"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { authenticate, type AuthState } from "./actions.ts";
import { SubmitButton } from "@/components/ui/button.tsx";
import { Field, inputClass } from "@/components/ui/primitives.tsx";
import { useKeepValuesOnError } from "@/components/ui/keep-values.ts";
import { PROVIDER_LABEL, type OAuthProvider } from "@/lib/auth/redirects.ts";

export type Mode = "signin" | "signup" | "reset" | "resend";

const SUBMIT: Record<Mode, string> = {
  signin: "Sign in",
  signup: "Create account",
  reset: "Email me a reset link",
  resend: "Send a new confirmation link",
};
const EMAIL_ONLY = new Set<Mode>(["reset", "resend"]);

/**
 * Sign in, create an account, ask for a reset link — and never be stuck because an email
 * did not arrive.
 *
 * The mode is a hidden field, not a bound action. Swapping the function passed to
 * `useActionState` does not reliably rebind it, so a user who toggled to "Sign in" was
 * still running sign-up; reading it from the submitted form removes that class of bug
 * and keeps the form working without JavaScript.
 *
 * After a sign-up the form becomes a waiting panel rather than a sentence: send a new link,
 * use a different address, sign in another way, or write to a person. A sign-in refused
 * because the address is unconfirmed offers the new link in place.
 */
export function SignInForm({ providers, next, initialMode = "signin" }: { providers: OAuthProvider[]; next: string; initialMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [state, submit] = useActionState<AuthState, FormData>(authenticate, {});
  const keepValues = useKeepValuesOnError(state);
  // "Use a different address" closes the waiting panel for this answer only; the next
  // answer from the server opens it again.
  const [dismissed, setDismissed] = useState<AuthState | null>(null);
  const awaiting = state.awaiting && dismissed !== state ? state.awaiting : null;

  if (awaiting) {
    return (
      <section aria-labelledby="awaiting-heading" className="mt-8 space-y-4">
        <h2 id="awaiting-heading" className="text-lg font-semibold">Check your inbox</h2>
        {state.error ? <Alert kind="error">{state.error}</Alert> : state.notice ? <Alert kind="notice">{state.notice}</Alert> : null}
        <p className="text-sm leading-relaxed text-ink-soft">
          The link is for <span className="font-medium text-ink">{awaiting}</span>. It can take a few minutes, and
          it sometimes lands in spam or promotions. Opening it in this browser signs you straight in; in another, it
          confirms the address and you sign in by hand.
        </p>
        <form action={submit}>
          <input type="hidden" name="mode" value="resend" />
          <input type="hidden" name="email" value={awaiting} />
          <SubmitButton variant="secondary" className="w-full justify-center" pendingLabel="Sending…">Send a new link</SubmitButton>
        </form>
        <div className="space-y-1 text-sm text-ink-soft">
          <p>
            Wrong address?{" "}
            <button type="button" onClick={() => { setDismissed(state); setMode("signup"); }} className={linkClass}>Use a different one</button>
          </p>
          <p>
            Already confirmed?{" "}
            <button type="button" onClick={() => { setDismissed(state); setMode("signin"); }} className={linkClass}>Sign in</button>
          </p>
          <p>
            Nothing after ten minutes? <Link href="/support" className={linkClass}>Write to us</Link> — a person reads it.
          </p>
        </div>
        {providers.length > 0 && <ProviderButtons providers={providers} next={next} submit={submit} label="Or continue with" />}
      </section>
    );
  }

  return (
    <div className="mt-8 space-y-6">
      {!EMAIL_ONLY.has(mode) && providers.length > 0 && (
        <>
          <ProviderButtons providers={providers} next={next} submit={submit} />
          <p className="flex items-center gap-3 text-xs uppercase tracking-[0.14em] text-ink-faint" aria-hidden="true">
            <span className="h-px flex-1 bg-line" />or with email<span className="h-px flex-1 bg-line" />
          </p>
        </>
      )}

      <form onSubmitCapture={keepValues} action={submit} className="space-y-4">
        <input type="hidden" name="mode" value={mode} />
        <input type="hidden" name="next" value={next} />

        <Field label="Email address" htmlFor="email">
          <input id="email" name="email" type="email" autoComplete="email" required maxLength={254} className={inputClass} />
        </Field>

        {!EMAIL_ONLY.has(mode) && (
          <Field label="Password" htmlFor="password" hint={mode === "signup" ? "At least 8 characters." : undefined}>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
              // Only when a password is being set. Enforcing a minimum on sign-in would
              // reject the correct password on an account created before the minimum.
              minLength={mode === "signup" ? 8 : undefined}
              maxLength={200}
              className={inputClass}
            />
          </Field>
        )}

        {state.error && <Alert kind="error">{state.error}</Alert>}
        {state.notice && <Alert kind="notice">{state.notice}</Alert>}

        <SubmitButton className="w-full justify-center" pendingLabel="Working…">{SUBMIT[mode]}</SubmitButton>
      </form>

      {state.unconfirmed && (
        <form action={submit}>
          <input type="hidden" name="mode" value="resend" />
          <input type="hidden" name="email" value={state.unconfirmed} />
          <SubmitButton variant="secondary" className="w-full justify-center" pendingLabel="Sending…">Send a new confirmation link</SubmitButton>
        </form>
      )}

      <div className="space-y-1 text-sm text-ink-soft">
        {EMAIL_ONLY.has(mode) ? (
          <p>
            {mode === "reset" ? "Remembered it? " : "Already confirmed? "}
            <button type="button" onClick={() => setMode("signin")} className={linkClass}>Sign in</button>
          </p>
        ) : (
          <>
            <p>
              {mode === "signin" ? "No account yet? " : "Already have an account? "}
              <button type="button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className={linkClass}>
                {mode === "signin" ? "Create one" : "Sign in"}
              </button>
            </p>
            {mode === "signin" && (
              <p>
                <button type="button" onClick={() => setMode("reset")} className={linkClass}>Forgotten your password?</button>
              </p>
            )}
          </>
        )}
        <p>
          Trouble signing in? <Link href="/docs/signing-in" className={linkClass}>What to try</Link> or{" "}
          <Link href="/support" className={linkClass}>write to us</Link>.
        </p>
      </div>
    </div>
  );
}

function ProviderButtons({ providers, next, submit, label }: { providers: OAuthProvider[]; next: string; submit: (form: FormData) => void; label?: string }) {
  return (
    <div className="space-y-2">
      {label && <p className="text-sm text-ink-soft">{label}</p>}
      {providers.map((p) => (
        <form key={p} action={submit}>
          <input type="hidden" name="mode" value="oauth" />
          <input type="hidden" name="provider" value={p} />
          <input type="hidden" name="next" value={next} />
          <SubmitButton variant="secondary" className="w-full justify-center" pendingLabel="Opening…">
            Continue with {PROVIDER_LABEL[p]}
          </SubmitButton>
        </form>
      ))}
    </div>
  );
}

function Alert({ kind, children }: { kind: "error" | "notice"; children: React.ReactNode }) {
  return kind === "error" ? (
    <p role="alert" className="rounded-lg border border-fail-border bg-fail-surface px-3 py-2 text-sm leading-relaxed text-fail-text">{children}</p>
  ) : (
    <p role="status" className="rounded-lg border border-pass-border bg-pass-surface px-3 py-2 text-sm leading-relaxed text-pass-text">{children}</p>
  );
}

const linkClass = "font-medium text-ink underline underline-offset-2 hover:text-ink-soft";
