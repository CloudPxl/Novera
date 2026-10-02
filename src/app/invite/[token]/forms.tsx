"use client";

import { useActionState } from "react";
import { acceptInvitation, holdInvitation, type IdentityState } from "@/lib/workflow/identity.ts";
import { SubmitButton } from "@/components/ui/button.tsx";

export function AcceptInvitationForm({ token }: { token: string }) {
  const [state, submit] = useActionState<IdentityState, FormData>(acceptInvitation, {});
  return (
    <form action={submit} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      {state.error && <p role="alert" className="rounded-control border border-fail-border bg-fail-surface px-3 py-2 text-sm text-fail-text">{state.error}</p>}
      <SubmitButton pendingLabel="Joining…">Accept and open the workspace</SubmitButton>
    </form>
  );
}

/** Signed out: keep the invitation in this browser, then sign in or create the account. */
export function HoldInvitationForm({ token }: { token: string }) {
  return (
    <form action={holdInvitation} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <p className="text-sm text-ink-soft">Sign in, or create an account with the invited address. You will come back here to accept.</p>
      <SubmitButton pendingLabel="Opening sign-in…">Sign in to accept</SubmitButton>
    </form>
  );
}
