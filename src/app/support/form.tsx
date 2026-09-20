"use client";

import { useActionState } from "react";
import { submitSupportRequest, submitTrialApplication, type InboundState } from "@/lib/support/actions.ts";
import { SubmitButton } from "@/components/ui/button.tsx";
import { Field, inputClass } from "@/components/ui/primitives.tsx";

export function InboundForm({
  kind,
  messageLabel,
  messageHint,
  submitLabel,
}: {
  kind: "support" | "trial_application";
  messageLabel: string;
  messageHint: string;
  submitLabel: string;
}) {
  const action = kind === "support" ? submitSupportRequest : submitTrialApplication;
  const [state, submit] = useActionState<InboundState, FormData>(action, {});

  if (state.notice) {
    return (
      <div
        role="status"
        className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm leading-relaxed text-emerald-900"
      >
        {state.notice}
      </div>
    );
  }

  return (
    <form action={submit} className="mt-8 space-y-5">
      <Field label="Email address" htmlFor="email" hint="So we can reply. Nothing else is done with it.">
        <input id="email" name="email" type="email" autoComplete="email" required className={inputClass} />
      </Field>

      <Field label="Organisation" htmlFor="organisation" hint="Optional.">
        <input id="organisation" name="organisation" autoComplete="organization" className={inputClass} />
      </Field>

      <Field label={messageLabel} htmlFor="message" hint={messageHint}>
        <textarea id="message" name="message" rows={6} required minLength={15} className={`${inputClass} leading-relaxed`} />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Sending…">{submitLabel}</SubmitButton>
        {state.error && (
          <span role="alert" className="text-sm font-medium text-rose-700">
            {state.error}
          </span>
        )}
      </div>
    </form>
  );
}
