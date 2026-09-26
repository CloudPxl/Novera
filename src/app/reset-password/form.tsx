"use client";

import { useActionState } from "react";
import { setNewPassword, type AuthState } from "../sign-in/actions.ts";
import { SubmitButton } from "@/components/ui/button.tsx";
import { Field, inputClass } from "@/components/ui/primitives.tsx";

export function NewPasswordForm() {
  const [state, submit] = useActionState<AuthState, FormData>(setNewPassword, {});

  return (
    <form action={submit} className="mt-8 space-y-4">
      <Field label="New password" htmlFor="password" hint="At least 8 characters.">
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={200}
          className={inputClass}
        />
      </Field>

      <Field label="New password again" htmlFor="confirmPassword">
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={200}
          className={inputClass}
        />
      </Field>

      {state.error && (
        <p role="alert" className="rounded-lg border border-fail-border bg-fail-surface px-3 py-2 text-sm leading-relaxed text-fail-text">
          {state.error}
        </p>
      )}

      <SubmitButton className="w-full justify-center" pendingLabel="Saving…">
        Save the new password
      </SubmitButton>
    </form>
  );
}
