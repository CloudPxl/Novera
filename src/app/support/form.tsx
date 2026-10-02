"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { submitSupportRequest, submitTrialApplication, type InboundState } from "@/lib/support/actions.ts";
import { SubmitButton } from "@/components/ui/button.tsx";
import { Field, inputClass } from "@/components/ui/primitives.tsx";
import { MESSAGE_MAX, EMAIL_MAX, ORGANISATION_MAX } from "@/lib/support/limits.ts";
import { useKeepValuesOnError } from "@/components/ui/keep-values.ts";

/**
 * The two public forms.
 *
 * Every limit the server enforces is also on the field, and the one a person can
 * plausibly reach is stated in the hint. A cap discovered by rejection costs a round
 * trip and reads as a telling-off; a cap stated in advance is just information.
 *
 * The counter appears only near the limit. A character count on an empty box is a
 * discouragement to write, which is the opposite of what a support form wants.
 */
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
  const keepValues = useKeepValuesOnError(state);
  const [length, setLength] = useState(0);
  const confirmation = useRef<HTMLDivElement>(null);

  // The form is replaced by the acknowledgement, so focus would otherwise fall to the
  // body — a keyboard or screen-reader user is left nowhere, after the one action on
  // the page. `role="status"` announces it; this is what puts the reader inside it.
  useEffect(() => {
    if (state.notice) confirmation.current?.focus();
  }, [state.notice]);

  if (state.notice) {
    return (
      <div
        ref={confirmation}
        role="status"
        tabIndex={-1}
        className="mt-8 rounded-xl border border-pass-border bg-pass-surface px-5 py-4 text-sm leading-relaxed text-pass-text outline-none focus-visible:ring-2 focus-visible:ring-pass-text"
      >
        {state.notice}
      </div>
    );
  }

  const remaining = MESSAGE_MAX - length;

  return (
    <form onSubmitCapture={keepValues} action={submit} className="mt-8 space-y-5">
      <Field label="Email address" htmlFor="email" hint="So we can reply. Nothing else is done with it, and your message is erased 90 days after the conversation last moved.">
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={EMAIL_MAX}
          className={inputClass}
        />
      </Field>

      <Field label="Organisation" htmlFor="organisation" hint="Optional.">
        <input
          id="organisation"
          name="organisation"
          autoComplete="organization"
          maxLength={ORGANISATION_MAX}
          className={inputClass}
        />
      </Field>

      <Field
        label={messageLabel}
        htmlFor="message"
        hint={`${messageHint} Up to ${MESSAGE_MAX.toLocaleString("en-GB")} characters.`}
      >
        <textarea
          id="message"
          name="message"
          rows={6}
          required
          minLength={15}
          maxLength={MESSAGE_MAX}
          onChange={(e) => setLength(e.target.value.length)}
          className={`${inputClass} leading-relaxed`}
        />
      </Field>

      {remaining <= 400 && (
        <p
          aria-live="polite"
          className={`-mt-3 text-xs ${remaining <= 0 ? "font-medium text-fail-text" : "text-ink-faint"}`}
        >
          {remaining > 0
            ? `${remaining.toLocaleString("en-GB")} characters left.`
            : "That is the limit for this form — email us if there is more to say."}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Sending…">{submitLabel}</SubmitButton>
        {state.error && (
          <span role="alert" className="text-sm font-medium text-fail-text">
            {state.error}
          </span>
        )}
      </div>
    </form>
  );
}
