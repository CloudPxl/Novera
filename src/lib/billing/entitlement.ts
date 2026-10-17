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
 *   4. Decision D3 (2026-10-12): the trial is the whole free tier. Once its three runs are used,
 *      a workspace on its own model key needs a plan or a grant like any other
 *      (`byokRequiresPlan`). Fair use (src/lib/billing/limits.ts) then applies to every source.
 *
 * This decides every run start: `workspaceEntitlement` (src/lib/auth/entitlement.ts) feeds it
 * stored rows and `startRun` stamps the run with the `judgeSource` and `funding` it returns,
 * which 0067 checks again under a lock.
 */
import { FEATURES, PLAN_CATALOG, READ_ONLY_FEATURES, isPlanKey, type Feature, type PlanKey } from "./plans.ts";
import { CONCURRENCY_REFUSAL, FAIR_USE_REFUSAL, FAIR_USE_RUNS, MAX_RUNS_IN_FLIGHT } from "./limits.ts";

/** Who funded a run's grading, as the run row and its report record it (0001, 0067). */
export type JudgeSource = "trial_free" | "workspace_key" | "plan_managed";

/**
 * Why a run cannot start, as a kind the interface can act on: a plan to choose, a key to
 * connect, a run to wait for, support to contact. The sentence is `blockedReason`.
 */
export type Blocker =
  | "trial_used" | "needs_plan" | "subscription_lapsed" | "allowance_used" | "grant_used"
  | "needs_key" | "key_unroutable" | "concurrency" | "fair_use";

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
  /** Runs counted against the trial: every run of every workspace this workspace's owner owns (0055), except one aborted before it recorded a scenario (0074). */
  trialRunsUsed: number;
  trialLimit: number;
  /** A model key is stored, and whether it can actually grade (see auth/entitlement.ts). */
  byok: { connected: boolean; routable: boolean; provider: string | null };
  /**
   * Decision D3 (2026-10-12): true. After the trial, a workspace on its own key needs a plan.
   * False restores the old rule (own key unmetered); kept as an input so the rule is stated, not
   * implied.
   */
  byokRequiresPlan: boolean;
  /** Runs in this workspace queued or running now (fair use: at most MAX_RUNS_IN_FLIGHT). */
  runsInFlight?: number;
  /** Runs this workspace started in the last FAIR_USE_WINDOW_DAYS days. */
  runsInWindow?: number;
  /** Every subscription row of this workspace. The newest decides. */
  subscriptions: SubscriptionRow[];
  grants: GrantRow[];
  /**
   * When each run in this workspace was created (ISO): every run that uses an allowance since
   * the earliest window start among the sources (the subscription's period start, each grant's
   * start) — every run except one aborted before it recorded a scenario (0074,
   * src/lib/billing/allowance.ts). A missing row would be an undercount, so the loader pages
   * through all of them.
   */
  runTimes: string[];
  /**
   * The subset of `runTimes` a plan's managed allowance counts: runs graded on Novera's keys
   * under a plan (`judge_source = 'plan_managed'`, 0067). Absent → every run counts, the
   * cautious reading.
   */
  managedRunTimes?: string[];
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
  /**
   * What the allowance above counts: runs on the workspace's own model key, or runs graded on
   * Novera's keys (the trial, a plan's managed runs). Null when nothing is in force.
   */
  runsOn: "own_key" | "novera" | null;
  /** When the allowance's window closes, if it has one. */
  windowEndsAt: string | null;
  canRun: boolean;
  blockedReason: string | null;
  /** What kind of block `blockedReason` is; null when a run can start. */
  blocker: Blocker | null;
  /** What a run started now is stamped with. Null when nothing funds one. */
  judgeSource: JudgeSource | null;
  /** The subscription or grant a run started now names (0067). Both null for a trial run. */
  funding: { subscriptionId: string | null; grantId: string | null };
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

/**
 * Whether Stripe could still charge for this subscription: any status Stripe may yet collect on
 * (active, trialing, past due — in grace or restricted —, unpaid, incomplete, paused) unless it is
 * set to end. Erasure is refused while this holds: Stripe goes on retrying a restricted or unpaid
 * subscription for weeks, and a paused one can resume, for a workspace that would no longer exist.
 */
export function subscriptionMayCharge(sub: SubscriptionRow | null, now: Date, graceDays: number): boolean {
  if (!sub || !CHARGEABLE_STATUSES.has(sub.status)) return false;
  const standing = subscriptionStanding(sub, now, graceDays);
  return standing?.standing !== "cancelling" && standing?.standing !== "ended";
}

const CHARGEABLE_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]);

interface Candidate {
  source: Exclude<EntitlementSource, "none">;
  planKey: PlanKey | null;
  runsOn: "own_key" | "novera";
  runsAllowed: number | null;
  runsUsed: number;
  windowEndsAt: string | null;
  features: Feature[];
  grantId: string | null;
  subscriptionId: string | null;
  /** Why this source has no room. Null when it has room. */
  exhausted: { reason: string; blocker: Blocker } | null;
}

const unroutable = (provider: string | null) => ({
  reason: `The ${provider ?? "stored"} key in this workspace has no model recorded to grade with. Connect the key again naming a model.`,
  blocker: "key_unroutable" as const,
});

/** The judge_source a run started under this decision is stamped with (0067). */
export function judgeSourceFor(source: EntitlementSource, runsOn: "own_key" | "novera" | null): JudgeSource | null {
  if (runsOn === "own_key") return "workspace_key";
  if (runsOn === "novera") return source === "trial" ? "trial_free" : "plan_managed";
  return null;
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
      runsOn: input.byok.connected ? "own_key" : "novera",
      runsAllowed: g.runsAllowed,
      runsUsed: used,
      windowEndsAt: g.endsAt,
      features: [...(plan?.features ?? FEATURES)],
      grantId: g.id,
      subscriptionId: null,
      exhausted: g.runsAllowed !== null && used >= g.runsAllowed
        ? { reason: `The ${g.kind} grant's ${g.runsAllowed} runs have been used.`, blocker: "grant_used" }
        : input.byok.connected && !input.byok.routable ? unroutable(input.byok.provider) : null,
    });
  }

  // 2. The subscription. Every plan grades on the workspace's own key without limit; without a
  //    key, only the plan's managed allowance (runs on Novera's keys) counts — none on Team BYOK.
  const current = currentSubscription(input.subscriptions);
  const sub = subscriptionStanding(current, now, input.graceDays);
  if (sub?.inForce && sub.planKey) {
    const plan = PLAN_CATALOG[sub.planKey];
    const renews = `The allowance renews${sub.periodEnd ? ` on ${sub.periodEnd.slice(0, 10)}` : " with the next period"}.`;
    if (input.byok.connected) {
      candidates.push({
        source: "subscription",
        planKey: plan.key,
        runsOn: "own_key",
        runsAllowed: null,
        runsUsed: countBetween(runTimes, ts(sub.periodStart), ts(sub.periodEnd)),
        windowEndsAt: sub.periodEnd,
        features: [...plan.features],
        grantId: null,
        subscriptionId: sub.stripeSubscriptionId,
        exhausted: input.byok.routable ? null : unroutable(input.byok.provider),
      });
    } else {
      const used = countBetween(input.managedRunTimes ?? runTimes, ts(sub.periodStart), ts(sub.periodEnd));
      const allowed = plan.managedRunsPerPeriod;
      candidates.push({
        source: "subscription",
        planKey: plan.key,
        runsOn: "novera",
        runsAllowed: allowed,
        runsUsed: used,
        windowEndsAt: sub.periodEnd,
        features: [...plan.features],
        grantId: null,
        subscriptionId: sub.stripeSubscriptionId,
        exhausted: allowed === 0
          ? { reason: `${plan.name} grades on your own model key, and this workspace has none. Connect one under Settings → Grading; runs graded on Novera's keys come with Agency Pro.`, blocker: "needs_key" }
          : used >= allowed
            ? { reason: `This billing period's ${allowed} runs graded on Novera's keys have been used. ${renews} Runs on your own model key are not limited.`, blocker: "allowance_used" }
            : null,
      });
    }
  }

  // 3. The workspace's own model key, unmetered — only where D3 does not apply (byokRequiresPlan
  //    false), which no deployment does since 2026-10-12. Kept so the rule stays a stated input.
  if (input.byok.connected && !input.byokRequiresPlan) {
    candidates.push({
      source: "byok",
      planKey: null,
      runsOn: "own_key",
      runsAllowed: null,
      runsUsed: input.totalRuns,
      windowEndsAt: null,
      features: [...FEATURES],
      grantId: null,
      subscriptionId: null,
      exhausted: input.byok.routable ? null : unroutable(input.byok.provider),
    });
  }

  // 4. The trial, which belongs to the owner across their workspaces. Under D3 it is the whole
  //    free tier: three runs, on Novera's keys or on the workspace's own key if it has one.
  if (!input.byok.connected || input.byokRequiresPlan) {
    const onKey = input.byok.connected;
    candidates.push({
      source: "trial",
      planKey: null,
      runsOn: onKey ? "own_key" : "novera",
      runsAllowed: input.trialLimit,
      runsUsed: input.trialRunsUsed,
      windowEndsAt: null,
      features: [...FEATURES],
      grantId: null,
      subscriptionId: null,
      exhausted: input.trialRunsUsed >= input.trialLimit
        ? {
            reason: onKey
              ? `The trial covers ${input.trialLimit} runs and they have been used. From here, runs on your own model key need a plan: Team BYOK, or Agency Pro, which adds runs graded on Novera's keys.`
              : `The trial covers ${input.trialLimit} runs and they have been used. Recurring testing needs a plan: Team BYOK grades on your own model key; Agency Pro adds 100 runs a month graded on Novera's keys.`,
            blocker: "trial_used",
          }
        : onKey && !input.byok.routable ? unroutable(input.byok.provider) : null,
    });
  }

  const chosen = candidates.find((c) => !c.exhausted);
  const trialOf = (c: Candidate | undefined) => (c?.source === "trial" ? { used: input.trialRunsUsed, limit: input.trialLimit } : null);
  if (chosen) {
    // Fair use applies whatever funds the run (0067 counts the same under a lock).
    const guard = (input.runsInWindow ?? 0) >= FAIR_USE_RUNS
      ? { reason: FAIR_USE_REFUSAL, blocker: "fair_use" as const }
      : (input.runsInFlight ?? 0) >= MAX_RUNS_IN_FLIGHT
        ? { reason: CONCURRENCY_REFUSAL, blocker: "concurrency" as const }
        : null;
    return {
      source: chosen.source,
      planKey: chosen.planKey,
      runsAllowed: chosen.runsAllowed,
      runsUsed: chosen.runsUsed,
      runsOn: chosen.runsOn,
      windowEndsAt: chosen.windowEndsAt,
      canRun: !guard,
      blockedReason: guard?.reason ?? null,
      blocker: guard?.blocker ?? null,
      judgeSource: judgeSourceFor(chosen.source, chosen.runsOn),
      funding: { subscriptionId: chosen.subscriptionId, grantId: chosen.grantId },
      features: chosen.features,
      subscription: sub,
      grantId: chosen.grantId,
      trial: trialOf(chosen),
    };
  }

  // Nothing has room. A subscription that stopped counting explains more than "the trial is
  // used": it is what the person was paying for.
  const first = candidates[0];
  const lapsed = sub && !sub.inForce && first?.source === "trial";
  if (first && !lapsed) {
    return {
      source: first.source,
      planKey: first.planKey,
      runsAllowed: first.runsAllowed,
      runsUsed: first.runsUsed,
      runsOn: first.runsOn,
      windowEndsAt: first.windowEndsAt,
      canRun: false,
      blockedReason: first.exhausted!.reason,
      blocker: first.exhausted!.blocker,
      judgeSource: null,
      funding: { subscriptionId: null, grantId: null },
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
    runsOn: null,
    windowEndsAt: null,
    canRun: false,
    blockedReason: sub && !sub.inForce
      ? `${sub.sentence} Runs need a plan in force; the trial's ${input.trialLimit} runs have been used.`
      : "Nothing allows new runs in this workspace. Every run and report already here stays readable.",
    blocker: sub && !sub.inForce ? "subscription_lapsed" : "needs_plan",
    judgeSource: null,
    funding: { subscriptionId: null, grantId: null },
    features: [...READ_ONLY_FEATURES],
    subscription: sub,
    grantId: null,
    trial: lapsed ? { used: input.trialRunsUsed, limit: input.trialLimit } : null,
  };
}

/** One line naming what funds runs in this workspace, from the decision above. */
export function fundingLine(e: BillingEntitlement, ownKey: boolean): string {
  const plan = e.planKey ? PLAN_CATALOG[e.planKey].name : null;
  const left = (allowed: number, used: number) => `${Math.max(0, allowed - used)} of ${allowed}`;
  switch (e.source) {
    case "trial":
      return `Trial${ownKey ? " · own key" : ""} · ${left(e.trial?.limit ?? e.runsAllowed ?? 0, e.trial?.used ?? e.runsUsed)} runs left`;
    case "subscription":
      return e.runsOn === "own_key" || e.runsAllowed === null
        ? `${plan} · own key`
        : `${plan} · ${left(e.runsAllowed, e.runsUsed)} managed runs left`;
    case "manual_grant":
      return e.runsAllowed === null ? "Grant from Novera" : `Grant · ${left(e.runsAllowed, e.runsUsed)} runs left`;
    case "byok":
      return "Own key";
    case "none":
      return "No plan";
  }
}
