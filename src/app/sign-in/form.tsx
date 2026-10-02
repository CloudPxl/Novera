"use client";

import { useActionState, useState } from "react";
import { authenticate, type AuthState } from "./actions.ts";
import { SubmitButton } from "@/components/ui/button.tsx";
import { Field, inputClass } from "@/components/ui/primitives.tsx";
import { useKeepValuesOnError } from "@/components/ui/keep-values.ts";

type Mode = "signin" | "signup" | "reset";

const SUBMIT: Record<Mode, string> = {
  signin: "Sign in",
  signup: "Create account",
  reset: "Email me a reset link",
};

/**
 * Sign in, create an account, or ask for a reset link.
 *
 * Three modes rather than two, because there was no third: a person who forgot their
 * password had no path at all except writing to support — while `/auth/confirm` had
 * handled `recovery` tokens all along and redirected them to a page that ignored it.
 *
 * The mode is a hidden field, not a bound action. Swapping the function passed to
 * `useActionState` does not reliably rebind it, so a user who toggled to "Sign in" was
 * still running sign-up; reading it from the submitted form removes that class of bug
 * and keeps the form working without JavaScript.
 */
export function SignInForm() {
  const [mode, setMode] = useState<Mode>("signin");
  const [state, submit] = useActionState<AuthState, FormData>(authenticate, {});
  const keepValues = useKeepValuesOnError(state);

  return (
    <form onSubmitCapture={keepValues} action={submit} className="mt-8 space-y-4">
      <input type="hidden" name="mode" value={mode} />

      <Field label="Email address" htmlFor="email">
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          className={inputClass}
        />
      </Field>

      {mode !== "reset" && (
        <Field
          label="Password"
          htmlFor="password"
          hint={mode === "signup" ? "At least 8 characters." : undefined}
        >
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

      {state.error && (
        <p role="alert" className="rounded-lg border border-fail-border bg-fail-surface px-3 py-2 text-sm leading-relaxed text-fail-text">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p role="status" className="rounded-lg border border-pass-border bg-pass-surface px-3 py-2 text-sm leading-relaxed text-pass-text">
          {state.notice}
        </p>
      )}

      <SubmitButton className="w-full justify-center" pendingLabel="Working…">
        {SUBMIT[mode]}
      </SubmitButton>

      <div className="space-y-1 text-sm text-ink-soft">
        {mode === "reset" ? (
          <p>
            Remembered it?{" "}
            <button type="button" onClick={() => setMode("signin")} className={linkClass}>
              Sign in
            </button>
          </p>
        ) : (
          <>
            <p>
              {mode === "signin" ? "No account yet? " : "Already have an account? "}
              <button
                type="button"
                onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                className={linkClass}
              >
                {mode === "signin" ? "Create one" : "Sign in"}
              </button>
            </p>
            {mode === "signin" && (
              <p>
                <button type="button" onClick={() => setMode("reset")} className={linkClass}>
                  Forgotten your password?
                </button>
              </p>
            )}
          </>
        )}
      </div>
    </form>
  );
}

const linkClass = "font-medium text-ink underline underline-offset-2 hover:text-ink-soft";
