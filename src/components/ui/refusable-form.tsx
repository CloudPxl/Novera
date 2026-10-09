"use client";

import { useActionState, type ReactNode } from "react";

interface RefusalState {
  error?: string;
}

/**
 * A form whose action either moves on (a redirect) or says why it would not.
 *
 * Starting a run was a plain form action that threw on a refusal — the trial used up, no
 * policy, an agent the suite cannot reach — and the person got the generic error page with
 * a reference number (app-wide audit, 2026-10-08). The action now returns the sentence, and
 * this renders it where the button is.
 */
export function RefusableForm({
  action,
  children,
  className,
}: {
  action: (state: RefusalState, form: FormData) => Promise<RefusalState>;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className={className}>
      {children}
      {state.error && (
        <p role="alert" className="mt-2 w-full text-sm leading-relaxed text-fail-text">
          {state.error}
        </p>
      )}
    </form>
  );
}
