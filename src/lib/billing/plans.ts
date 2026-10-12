/**
 * The plan catalog: keys, approved list prices, allowances and what each grants. Mirrored by
 * `billing_plans` (0060, prices and allowances from 0066; tests/billing.test.ts holds them
 * together).
 *
 * Prices were approved by David on 2026-10-12 (docs/BILLING-DECISIONS.md §2). The price a
 * workspace pays is Stripe's, through the server-side allow-list; the list price here is what
 * the billing page shows, and checkout refuses a Stripe price that does not match it, so the
 * page can never show one amount while Stripe charges another.
 *
 * Every plan is still `draft`: sellable in a Stripe sandbox, never live. A plan becomes
 * sellable live only by a change to this file and a migration, both approved by David, after
 * the live checklist (BILLING-DECISIONS §7).
 */

export const PLAN_KEYS = ["team_byok", "agency_pro"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

/** What a workspace may do. Nothing in the product is gated on these yet (docs/BILLING-DECISIONS.md). */
export const FEATURES = ["runs.start", "schedules", "api", "mcp", "webhooks", "evidence.read", "reports.export"] as const;
export type Feature = (typeof FEATURES)[number];

/** What a workspace keeps when nothing pays for it: its evidence, readable and exportable. Never deleted. */
export const READ_ONLY_FEATURES: Feature[] = ["evidence.read", "reports.export"];

export interface Plan {
  key: PlanKey;
  name: string;
  /** Who the plan is for, in one line. */
  audience: string;
  /** The approved list price per month, in euro cents. Stripe's price must be exactly this. */
  monthlyPriceCents: number;
  currency: "eur";
  interval: "month";
  /**
   * Runs graded on Novera's own model keys per billing period ("managed" runs). 0 means none:
   * the plan grades on the workspace's own key.
   */
  managedRunsPerPeriod: number;
  /** Runs graded on the workspace's own model key: unlimited on every plan. */
  ownKeyRuns: "unlimited";
  features: readonly Feature[];
  status: "draft" | "disabled";
}

export const PLAN_CATALOG: Record<PlanKey, Plan> = {
  team_byok: {
    key: "team_byok",
    name: "Team BYOK",
    audience: "Agencies and development teams grading on their own model key.",
    monthlyPriceCents: 9_900,
    currency: "eur",
    interval: "month",
    managedRunsPerPeriod: 0,
    ownKeyRuns: "unlimited",
    features: FEATURES,
    status: "draft",
  },
  agency_pro: {
    key: "agency_pro",
    name: "Agency Pro",
    audience: "Agencies delivering several client agents, with multi-model grading funded by Novera.",
    monthlyPriceCents: 29_900,
    currency: "eur",
    interval: "month",
    managedRunsPerPeriod: 100,
    ownKeyRuns: "unlimited",
    features: FEATURES,
    status: "draft",
  },
};

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && (PLAN_KEYS as readonly string[]).includes(value);
}

/** The plan a Stripe price id stands for, from the server's allow-list only. Unknown → null. */
export function planForPrice(priceId: string | null | undefined, prices: Partial<Record<PlanKey, string>>): PlanKey | null {
  if (!priceId) return null;
  for (const key of PLAN_KEYS) if (prices[key] === priceId) return key;
  return null;
}

/** "€99" — whole euros, as the catalog states them. */
export function formatPlanPrice(plan: Plan): string {
  const euros = plan.monthlyPriceCents / 100;
  return `€${Number.isInteger(euros) ? euros : euros.toFixed(2)}`;
}
