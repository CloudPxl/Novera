/**
 * What a workspace may do, merged from every source that can allow it: a manual grant, a
 * Stripe subscription, the workspace's own model key (BYOK), the trial. A pure function of
 * stored rows — counts are counted, never estimated — so the settings page, a future run
 * gate and the tests all get the same answer from the same input.
 *
 * Rules, in the order they are applied:
 *   1. A source is *in force* or not. A grant is in force between its start and end until
 *      revoked. A subscription is in force while Stripe says active or trialing, while it is
 *      past_due inside the grace period, and while it is cancelling at period end (until that
 *      end). incomplete, incomplete_expired, unpaid, canceled, paused, an unknown status, or a
 *      price that is not on the allow-list: not in force.
 *   2. Sources do not add up. Each is a window over the same run rows; the first in-force
 *      source in precedence order (grant → subscription → BYOK → trial) that still has room
 *      decides. If none has room, the highest-precedence in-force source says why.
 *   3. Nothing here deletes or hides evidence. A workspace with nothing in force keeps
 *      reading and exporting everything it has (`READ_ONLY_FEATURES`).
 *
 * Not yet wired into starting a run: `src/lib/auth/entitlement.ts` still decides that, with
 * today's rules (trial, then BYOK unmetered). Wiring this in waits on the decisions listed in
 * docs/BILLING-DECISIONS.md — chiefly whether a paid plan's runs are graded on Novera's keys,
 * which would need a new `judge_source` and a change to the trial cap trigger (0055).
 */
import { FEATURES, PLAN_CATALOG, READ_ONLY_FEATURES, isPlanKey, type Feature, type PlanKey } from "./plans.ts";

export const DAY_MS = 86_400_000;

export interface SubscriptionRow {
  stripeSubscriptionId: string;
  status: string;
  planKey: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  delinquentSince: string | null;
  stripeCreatedAt: string;
}

export interface GrantRow {
  id: string;
  kind: "pilot" | "support" | "internal" | "compensation";
  planKey: string | null;
  runsAllowed: number | null;
  startsAt: string;
  endsAt: string | null;
  revokedAt: string | null;
}

export interface EntitlementInput {
  now: Date;
  graceDays: number;
  /** Runs counted against the trial: every run of every workspace this workspace's owner owns (0055). */
  trialRunsUsed: number;
  trialLimit: number;
  /** A model key is stored, and whether it can actually grade (see auth/entitlement.ts). */
  byok: { connected: boolean; routable: boolean; provider: string | null };
  /** Today's rule is false: a workspace on its own key is unmetered. A product decision, not a default to flip quietly. */
  byokRequiresPlan: boolean;
  /** Every subscription row of this workspace. The newest decides. */
  subscriptions: SubscriptionRow[];
  grants: GrantRow[];
  /**
   * When each run in this workspace was created (ISO): every run since the earliest window
   * start among the sources (the subscription's period start, each grant's start). A missing
   * row would be an undercount, so the loader pages through all of them.
   */
  runTimes: string[];
  /** Every run this workspace ever started, counted by the database. */
  totalRuns: number;
}

export type Standing =
  | "none" | "active" | "trialing" | "cancelling" | "grace" | "restricted"
  | "incomplete" | "ended" | "paused" | "unrecognised";

export interface SubscriptionView {
  stripeSubscriptionId: string;
  status: string;
  standing: Standing;
  inForce: boolean;
  planKey: PlanKey | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** When access ends because a cancellation was scheduled. */
  endsAt: string | null;
  /** When a past-due subscription stops counting. */
  graceEndsAt: string | null;
  sentence: string;
}

export type EntitlementSource = "manual_grant" | "subscription" | "byok" | "trial" | "none";

export interface BillingEntitlement {
  source: EntitlementSource;
  planKey: PlanKey | null;
  /** Null means unmetered. */
  runsAllowed: number | null;
  runsUsed: number;
  /** When the allowance's window closes, if it has one. */
  windowEndsAt: string | null;
  canRun: boolean;
  blockedReason: string | null;
  features: Feature[];
  subscription: SubscriptionView | null;
  /** The grant in force, if one decided. */
  grantId: string | null;
  /** Trial numbers, only when the trial is what applies or what ran out. */
  trial: { used: number; limit: number } | null;
}

const ts = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : null;
};

function countBetween(runTimes: string[], from: number | null, to: number | null): number {
  let n = 0;
  for (const t of runTimes) {
    const v = ts(t);
    if (v === null) continue;
    if (from !== null && v < from) continue;
    if (to !== null && v >= to) continue;
    n++;
  }
  return n;
}

/** The newest subscription by Stripe's creation time; a later one replaces an earlier one. */
export function currentSubscription(rows: SubscriptionRow[]): SubscriptionRow | null {
  return [...rows].sort((a, b) => (ts(b.stripeCreatedAt) ?? 0) - (ts(a.stripeCreatedAt) ?? 0))[0] ?? null;
}

export function subscriptionStanding(sub: SubscriptionRow | null, now: Date, graceDays: number): SubscriptionView | null {
  if (!sub) return null;
  const planKey = isPlanKey(sub.planKey) ? sub.planKey : null;
  const base = {
    stripeSubscriptionId: sub.stripeSubscriptionId,
    status: sub.status,
    planKey,
    periodStart: sub.currentPeriodStart,
    periodEnd: sub.currentPeriodEnd,
    endsAt: null as string | null,
    graceEndsAt: null as string | null,
  };
  const at = now.getTime();
  const view = (standing: Standing, inForce: boolean, sentence: string, extra: Partial<SubscriptionView> = {}): SubscriptionView =>
    ({ ...base, standing, inForce, sentence, ...extra });

  if (!planKey && ["active", "trialing", "past_due"].includes(sub.status)) {
    return view("unrecognised", false, "The subscription's price is not one Novera offers, so it grants nothing. Contact support.");
  }

  switch (sub.status) {
    case "active":
    case "trialing": {
      const scheduledEnd = sub.cancelAt ?? (sub.cancelAtPeriodEnd ? sub.currentPeriodEnd : null);
      const endTs = ts(scheduledEnd);
      if (endTs !== null) {
        if (at >= endTs) return view("ended", false, "The subscription was cancelled and its last paid period has ended.", { endsAt: scheduledEnd });
        return view("cancelling", true, "The subscription is cancelled at the end of the current period; until then nothing changes.", { endsAt: scheduledEnd });
      }
      return sub.status === "trialing"
        ? view("trialing", true, "The subscription is in its trial period.")
        : view("active", true, "The subscription is active.");
    }
    case "past_due": {
      const since = ts(sub.delinquentSince) ?? at;
      const graceEnd = since + graceDays * DAY_MS;
      const graceEndsAt = new Date(graceEnd).toISOString();
      return at < graceEnd
        ? view("grace", true, "A payment failed. Stripe is retrying; the plan stays in force until the grace period ends.", { graceEndsAt })
        : view("restricted", false, "A payment failed and the grace period is over. Update the payment method to restore the plan; nothing has been deleted.", { graceEndsAt });
    }
    case "unpaid":
      return view("restricted", false, "Payment could not be collected after every retry. Update the payment method to restore the plan; nothing has been deleted.");
    case "incomplete":
      return view("incomplete", false, "The first payment has not completed, so the plan has not started.");
    case "incomplete_expired":
      return view("ended", false, "The first payment never completed and the checkout expired. Nothing was charged for it.");
    case "canceled":
      return view("ended", false, "The subscription has ended. Every run and report stays readable.");
    case "paused":
      return view("paused", false, "The subscription is paused.");
    default:
      return view("unrecognised", false, `The subscription is in a state Novera does not recognise (${sub.status}), so it grants nothing until Stripe reports a known one.`);
  }
}

interface Candidate {
  source: Exclude<EntitlementSource, "none">;
  planKey: PlanKey | null;
  runsAllowed: number | null;
  runsUsed: number;
  windowEndsAt: string | null;
  features: Feature[];
  grantId: string | null;
  /** Why this source has no room. Null when it has room. */
  exhausted: string | null;
}

export function resolveEntitlement(input: EntitlementInput): BillingEntitlement {
  const { now, runTimes } = input;
  const at = now.getTime();
  const candidates: Candidate[] = [];

  // 1. Manual grants in force, newest first.
  const grants = input.grants
    .filter((g) => !g.revokedAt && (ts(g.startsAt) ?? Infinity) <= at && (g.endsAt === null || at < (ts(g.endsAt) ?? -Infinity)))
    .sort((a, b) => (ts(b.startsAt) ?? 0) - (ts(a.startsAt) ?? 0));
  for (const g of grants) {
    const used = countBetween(runTimes, ts(g.startsAt), ts(g.endsAt));
    const plan = isPlanKey(g.planKey) ? PLAN_CATALOG[g.planKey] : null;
    candidates.push({
      source: "manual_grant",
      planKey: plan?.key ?? null,
      runsAllowed: g.runsAllowed,
      runsUsed: used,
      windowEndsAt: g.endsAt,
      features: [...(plan?.features ?? FEATURES)],
      grantId: g.id,
      exhausted: g.runsAllowed !== null && used >= g.runsAllowed
        ? `The ${g.kind} grant's ${g.runsAllowed} runs have been used.`
        : null,
    });
  }

  // 2. The subscription.
  const sub = subscriptionStanding(currentSubscription(input.subscriptions), now, input.graceDays);
  if (sub?.inForce && sub.planKey) {
    const plan = PLAN_CATALOG[sub.planKey];
    const used = countBetween(runTimes, ts(sub.periodStart), ts(sub.periodEnd));
    candidates.push({
      source: "subscription",
      planKey: plan.key,
      runsAllowed: plan.runsPerPeriod,
      runsUsed: used,
      windowEndsAt: sub.periodEnd,
      features: [...plan.features],
      grantId: null,
      exhausted: used >= plan.runsPerPeriod
        ? `This billing period's ${plan.runsPerPeriod} runs have been used. The allowance renews${sub.periodEnd ? ` on ${sub.periodEnd.slice(0, 10)}` : " with the next period"}.`
        : null,
    });
  }

  // 3. The workspace's own model key: unmetered, as today, unless that rule is changed on purpose.
  if (input.byok.connected && !input.byokRequiresPlan) {
    candidates.push({
      source: "byok",
      planKey: null,
      runsAllowed: null,
      runsUsed: input.totalRuns,
      windowEndsAt: null,
      features: [...FEATURES],
      grantId: null,
      exhausted: input.byok.routable
        ? null
        : `The ${input.byok.provider ?? "stored"} key in this workspace has no model recorded to grade with. Connect the key again naming a model.`,
    });
  }

  // 4. The trial, which belongs to the owner across their workspaces; only without a key.
  if (!input.byok.connected) {
    candidates.push({
      source: "trial",
      planKey: null,
      runsAllowed: input.trialLimit,
      runsUsed: input.trialRunsUsed,
      windowEndsAt: null,
      features: [...FEATURES],
      grantId: null,
      exhausted: input.trialRunsUsed >= input.trialLimit
        ? `The trial covers ${input.trialLimit} runs and they have been used.`
        : null,
    });
  }

  const chosen = candidates.find((c) => !c.exhausted);
  const trialOf = (c: Candidate | undefined) => (c?.source === "trial" ? { used: input.trialRunsUsed, limit: input.trialLimit } : null);
  if (chosen) {
    return {
      source: chosen.source,
      planKey: chosen.planKey,
      runsAllowed: chosen.runsAllowed,
      runsUsed: chosen.runsUsed,
      windowEndsAt: chosen.windowEndsAt,
      canRun: true,
      blockedReason: null,
      features: chosen.features,
      subscription: sub,
      grantId: chosen.grantId,
      trial: trialOf(chosen),
    };
  }

  const first = candidates[0];
  if (first) {
    return {
      source: first.source,
      planKey: first.planKey,
      runsAllowed: first.runsAllowed,
      runsUsed: first.runsUsed,
      windowEndsAt: first.windowEndsAt,
      canRun: false,
      blockedReason: first.exhausted,
      // Out of runs is not out of evidence: everything else the source grants stays.
      features: first.features.filter((f) => f !== "runs.start"),
      subscription: sub,
      grantId: first.grantId,
      trial: trialOf(first),
    };
  }

  return {
    source: "none",
    planKey: null,
    runsAllowed: 0,
    runsUsed: input.totalRuns,
    windowEndsAt: null,
    canRun: false,
    blockedReason: sub && !sub.inForce
      ? sub.sentence
      : "Nothing allows new runs in this workspace. Every run and report already here stays readable.",
    features: [...READ_ONLY_FEATURES],
    subscription: sub,
    grantId: null,
    trial: null,
  };
}
