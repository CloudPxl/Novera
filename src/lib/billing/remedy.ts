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

export function remedyFor(blocker: Blocker | null): Remedy | null {
  switch (blocker) {
    case null:
      return null;
    case "trial_used":
    case "needs_plan":
      return { href: BILLING_PATH, label: "Choose a plan" };
    case "allowance_used":
    case "grant_used":
      return { href: BILLING_PATH, label: "See plans" };
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
