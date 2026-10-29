import { billingConfig } from "./config.ts";
import type { Blocker } from "./entitlement.ts";

/**
 * Where a person goes about a blocked run, by the kind of block. Every surface that says "runs
 * cannot start" — the top bar, the run launcher, the dashboard, an agent's page — offers the
 * same next step, so a plan problem always leads to the billing page and a key problem to
 * Settings, never the other way round.
 *
 * `/billing` resolves to Settings → Billing (src/app/(app)/billing/page.tsx).
 */
export interface Remedy {
  href: string;
  label: string;
}

export const BILLING_PATH = "/billing";

export function remedyFor(blocker: Blocker | null, billingOpen: boolean = billingConfig().active): Remedy | null {
  switch (blocker) {
    case null:
      return null;
    // While billing is not open, every Subscribe button on Billing is disabled: "Choose a plan" led
    // a tester to a page with nothing to choose. The same page holds the pilot code and the pilot
    // request, and that is what the label names until a plan can be bought (final audit A-2).
    case "trial_used":
    case "needs_plan":
      return { href: BILLING_PATH, label: billingOpen ? "Choose a plan" : "Get pilot access" };
    case "allowance_used":
    case "grant_used":
      return { href: BILLING_PATH, label: billingOpen ? "See plans" : "Get pilot access" };
    case "subscription_lapsed":
      return { href: BILLING_PATH, label: "Open billing" };
    case "needs_key":
    case "key_unroutable":
      return { href: "/settings", label: "Connect a model key" };
    case "concurrency":
      return { href: "/runs", label: "See runs in progress" };
    case "fair_use":
      return { href: "/support", label: "Contact support" };
  }
}

/** True when the block is about paying: the person who can fix it is an owner or admin. */
export function needsBillingAction(blocker: Blocker | null): boolean {
  return blocker === "trial_used" || blocker === "needs_plan" || blocker === "allowance_used"
    || blocker === "grant_used" || blocker === "subscription_lapsed";
}
