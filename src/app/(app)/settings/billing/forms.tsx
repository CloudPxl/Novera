"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button.tsx";
import { openBillingPortal, setCancellation, startCheckout, type BillingFormState } from "@/lib/billing/actions.ts";

function Message({ state }: { state: BillingFormState }) {
  if (state.error) return <p role="status" className="mt-2 text-sm text-fail-text">{state.error}</p>;
  if (state.notice) return <p role="status" className="mt-2 text-sm text-ink-soft">{state.notice}</p>;
  return null;
}

/** One plan key, nothing else: the price and the workspace are the server's to decide. */
export function CheckoutButton({ plan, label, block = false }: { plan: string; label: string; block?: boolean }) {
  const [state, submit] = useActionState<BillingFormState, FormData>(startCheckout, {});
  return (
    <form action={submit}>
      <input type="hidden" name="plan" value={plan} />
      <SubmitButton size="sm" pendingLabel="Opening Stripe…" className={block ? "w-full justify-center" : ""}>{label}</SubmitButton>
      <Message state={state} />
    </form>
  );
}

export function PortalButton({ disabled, label = "Payment method and invoices", block = false }: { disabled: boolean; label?: string; block?: boolean }) {
  const [state, submit] = useActionState<BillingFormState, FormData>(openBillingPortal, {});
  return (
    <form action={submit}>
      <SubmitButton size="sm" variant="secondary" disabled={disabled} pendingLabel="Opening Stripe…" className={block ? "w-full justify-center" : ""}>
        {label}
      </SubmitButton>
      <Message state={state} />
    </form>
  );
}

export function CancellationButton({ cancelling }: { cancelling: boolean }) {
  const [state, submit] = useActionState<BillingFormState, FormData>(setCancellation, {});
  return (
    <form action={submit}>
      <input type="hidden" name="cancel" value={cancelling ? "no" : "yes"} />
      <SubmitButton size="sm" variant={cancelling ? "secondary" : "danger"} pendingLabel="Asking Stripe…">
        {cancelling ? "Keep the subscription" : "Cancel at the end of the period"}
      </SubmitButton>
      <Message state={state} />
    </form>
  );
}
