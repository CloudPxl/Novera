/**
 * The plan catalog: keys, allowances and what each grants. Mirrored by `billing_plans` in
 * 0060 (tests/billing.test.ts holds them together). No price and no currency here — prices
 * live in Stripe and are undecided; this file says what a plan *grants*, not what it costs.
 *
 * Every plan is `draft`: sellable in a Stripe sandbox, never live. A plan becomes sellable
 * live only by a change to this file and a migration, both approved by David.
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
  /** Runs per billing period. */
  runsPerPeriod: number;
  features: readonly Feature[];
  status: "draft" | "disabled";
}

export const PLAN_CATALOG: Record<PlanKey, Plan> = {
  team_byok: {
    key: "team_byok",
    name: "Team (bring your own model key) — placeholder",
    runsPerPeriod: 30,
    features: FEATURES,
    status: "draft",
  },
  agency_pro: {
    key: "agency_pro",
    name: "Agency Pro — placeholder",
    runsPerPeriod: 150,
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
