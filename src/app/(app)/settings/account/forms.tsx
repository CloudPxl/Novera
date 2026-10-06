"use client";

import { useActionState } from "react";
import { linkProviderAction, passwordAction, signOutEverywhereAction, unlinkProviderAction } from "@/lib/workflow/sign-in-methods.ts";
import type { FormState } from "@/lib/workflow/actions.ts";
import { SubmitButton } from "@/components/ui/button.tsx";
import { Field, inputClass } from "@/components/ui/primitives.tsx";
import { PROVIDER_LABEL, type OAuthProvider } from "@/lib/auth/redirects.ts";

function Result({ state }: { state: FormState }) {
  if (state.error) return <p role="alert" className="rounded-control border border-fail-border bg-fail-surface px-3 py-2 text-sm text-fail-text">{state.error}</p>;
  if (state.notice) return <p role="status" className="rounded-control border border-pass-border bg-pass-surface px-3 py-2 text-sm text-pass-text">{state.notice}</p>;
  return null;
}

export function LinkProviderForm({ provider }: { provider: OAuthProvider }) {
  const [state, submit] = useActionState<FormState, FormData>(linkProviderAction, {});
  return (
    <form action={submit} className="space-y-2">
      <input type="hidden" name="provider" value={provider} />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Opening…">Connect {PROVIDER_LABEL[provider]}</SubmitButton>
      <Result state={state} />
    </form>
  );
}

export function UnlinkProviderForm({ identityId, label, disabledReason }: { identityId: string; label: string; disabledReason?: string }) {
  const [state, submit] = useActionState<FormState, FormData>(unlinkProviderAction, {});
  return (
    <form action={submit} className="space-y-2">
      <input type="hidden" name="identityId" value={identityId} />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Disconnecting…" disabled={Boolean(disabledReason)}>
        Disconnect<span className="sr-only"> {label}</span>
      </SubmitButton>
      {disabledReason && <p className="text-xs text-ink-faint">{disabledReason}</p>}
      <Result state={state} />
    </form>
  );
}

/** Passwords are never restored after a refusal; the fields are typed again. */
export function PasswordForm({ existing }: { existing: boolean }) {
  const [state, submit] = useActionState<FormState, FormData>(passwordAction, {});
  return (
    <form action={submit} className="space-y-3">
      {existing && (
        <Field label="Current password" htmlFor="current-password">
          <input id="current-password" name="currentPassword" type="password" autoComplete="current-password" required maxLength={200} className={inputClass} />
        </Field>
      )}
      <Field label={existing ? "New password" : "Password"} htmlFor="new-password" hint="At least 8 characters.">
        <input id="new-password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={200} className={inputClass} />
      </Field>
      <Field label={existing ? "New password again" : "Password again"} htmlFor="confirm-password">
        <input id="confirm-password" name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={200} className={inputClass} />
      </Field>
      <Result state={state} />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">{existing ? "Change password" : "Add a password"}</SubmitButton>
    </form>
  );
}

export function SignOutEverywhereForm() {
  const [state, submit] = useActionState<FormState, FormData>(signOutEverywhereAction, {});
  return (
    <form action={submit} className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" className="size-4 accent-current" />End every session, including this one</label>
      <SubmitButton size="sm" variant="danger" pendingLabel="Signing out…">Sign out everywhere</SubmitButton>
      <Result state={state} />
    </form>
  );
}
