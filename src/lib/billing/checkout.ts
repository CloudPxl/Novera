/**
 * What may be sold, to whom, decided on the server before Stripe is called.
 *
 * The browser sends one thing: a plan key. Never a price id, a customer id or a workspace id —
 * the workspace is the person's active one, checked against live membership, and the price is
 * looked up in the server's allow-list. A plan is sellable in a Stripe sandbox while it is a
 * draft and never in live mode until it is approved (no plan is).
 */
import type { BillingConfig } from "./config.ts";
import type { CheckoutRequest } from "./gateway.ts";
import { subscriptionStanding, type SubscriptionRow } from "./entitlement.ts";
import { PLAN_CATALOG, isPlanKey, type PlanKey } from "./plans.ts";

export type CheckoutDecision = { ok: true; planKey: PlanKey; priceId: string } | { ok: false; error: string };

/** Statuses for which a second subscription would double-charge: change it in the portal instead. */
const OPEN_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]);

export function decideCheckout(args: {
  config: BillingConfig;
  requestedPlan: unknown;
  subscriptions: SubscriptionRow[];
}): CheckoutDecision {
  const { config, requestedPlan, subscriptions } = args;
  if (!config.active) return { ok: false, error: config.reason ?? "Billing is not active yet." };
  if (!isPlanKey(requestedPlan)) return { ok: false, error: "That plan is not offered." };
  const plan = PLAN_CATALOG[requestedPlan];
  if (plan.status === "disabled") return { ok: false, error: "That plan is not offered." };
  if (config.mode === "live" && plan.status === "draft") {
    return { ok: false, error: "That plan has not been approved for sale." };
  }
  const priceId = config.prices[requestedPlan];
  if (!priceId) return { ok: false, error: "That plan has no price configured yet." };

  const open = subscriptions.find((s) => OPEN_STATUSES.has(s.status) && !(subscriptionStanding(s, new Date(), config.graceDays)?.standing === "ended"));
  if (open) {
    return { ok: false, error: "This workspace already has a subscription. Change or cancel it in the billing portal instead of starting another." };
  }
  return { ok: true, planKey: requestedPlan, priceId };
}

export function checkoutRequest(args: {
  config: BillingConfig;
  decision: { planKey: PlanKey; priceId: string };
  customer: string;
  workspaceId: string;
  origin: string;
}): CheckoutRequest {
  const { config, decision, customer, workspaceId, origin } = args;
  return {
    customer,
    priceId: decision.priceId,
    workspaceId,
    planKey: decision.planKey,
    // The return page reads nothing from these parameters except which sentence to show.
    successUrl: `${origin}/settings/billing?checkout=returned`,
    cancelUrl: `${origin}/settings/billing?checkout=cancelled`,
    automaticTax: config.automaticTax,
    taxIdCollection: config.taxIdCollection,
  };
}

/** Stripe-hosted pages only: a session URL anywhere else is not followed. */
export function isStripeHostedUrl(url: string | null | undefined, host: "checkout.stripe.com" | "billing.stripe.com"): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === host;
  } catch {
    return false;
  }
}
