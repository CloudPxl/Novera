/**
 * What a plan card on the billing page offers, decided from stored state and configuration
 * only — pure, so every branch is tested rather than eyeballed. The page renders it; the
 * server actions still decide everything again when a button is pressed.
 */
import type { BillingConfig } from "./config.ts";
import { PRICE_ENV } from "./config.ts";
import type { SubscriptionView } from "./entitlement.ts";
import { PLAN_CATALOG, type PlanKey } from "./plans.ts";

export type PlanAction =
  | { kind: "checkout"; label: string }
  | { kind: "portal"; label: string; disabled: boolean }
  | { kind: "unavailable"; label: string; reason: string }
  | { kind: "members"; reason: string };

/** A subscription in any of these states is still the workspace's: change it, do not buy another. */
const CLOSED = new Set(["ended", "none"]);

export function planAction(args: {
  plan: PlanKey;
  manage: boolean;
  config: Pick<BillingConfig, "active" | "mode">;
  sellable: boolean;
  hasCustomer: boolean;
  subscription: SubscriptionView | null;
  /** The current terms are accepted for this workspace (0068). Absent: not asked. */
  termsAccepted?: boolean;
}): PlanAction {
  const { plan, manage, config, sellable, hasCustomer, subscription: sub } = args;
  if (!manage) return { kind: "members", reason: "The owner and admins choose the plan." };

  const open = sub && !CLOSED.has(sub.standing) ? sub : null;
  const portalReady = config.active && hasCustomer;
  if (open && open.planKey === plan) return { kind: "portal", label: "Manage this plan", disabled: !portalReady };
  if (open) return { kind: "portal", label: "Change plan in the billing portal", disabled: !portalReady };

  if (!config.active) return { kind: "unavailable", label: "Subscribe", reason: "Billing is not active yet." };
  if (config.mode === "live" && PLAN_CATALOG[plan].status === "draft") {
    return { kind: "unavailable", label: "Not on sale yet", reason: "This plan opens when live billing starts." };
  }
  if (!sellable) {
    return config.mode === "test"
      ? { kind: "unavailable", label: "Subscribe", reason: `No Stripe price is set for this plan (${PRICE_ENV[plan]}).` }
      : { kind: "unavailable", label: "Not on sale yet", reason: "This plan is not on sale yet." };
  }
  if (args.termsAccepted === false) {
    return { kind: "unavailable", label: config.mode === "test" ? "Subscribe in the sandbox" : "Subscribe", reason: "Give the business details and accept the terms above first." };
  }
  return { kind: "checkout", label: config.mode === "test" ? "Subscribe in the sandbox" : "Subscribe" };
}
