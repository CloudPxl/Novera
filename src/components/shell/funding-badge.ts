import type { Entitlement } from "@/lib/auth/entitlement.ts";
import { PLAN_CATALOG } from "@/lib/billing/plans.ts";

/**
 * The top bar's compact funding badge: a few words, derived from the stored entitlement.
 * The full sentence (`entitlement.fundingLine`, plus the block's reason when runs are
 * refused) stays available as the accessible label.
 */
export function fundingBadge(e: Entitlement): { text: string; tone: "fail" | "pass" | "neutral" } {
  const b = e.billing;
  if (!e.canRun) {
    if (e.blocker === "trial_used") return { text: "Trial used", tone: "fail" };
    if (e.blocker === "subscription_lapsed") return { text: "Plan lapsed", tone: "fail" };
    if (e.blocker === "allowance_used" || e.blocker === "grant_used") return { text: "Allowance used", tone: "fail" };
    if (e.blocker === "needs_plan") return { text: "No plan", tone: "fail" };
    return { text: "Runs blocked", tone: "fail" };
  }
  switch (b.source) {
    case "trial": {
      const limit = b.trial?.limit ?? b.runsAllowed ?? 0;
      const left = Math.max(0, limit - (b.trial?.used ?? b.runsUsed ?? 0));
      return { text: `Trial · ${left} left`, tone: "neutral" };
    }
    case "subscription":
      return { text: b.planKey ? `Plan: ${PLAN_CATALOG[b.planKey].name}` : "Plan", tone: "pass" };
    case "manual_grant":
      return { text: b.runsAllowed == null ? "Grant" : `Grant · ${Math.max(0, b.runsAllowed - b.runsUsed)} left`, tone: "pass" };
    case "byok":
      return { text: "Own key", tone: "neutral" };
    default:
      return { text: "No plan", tone: "neutral" };
  }
}
