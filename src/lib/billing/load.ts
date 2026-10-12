import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { workspaceEntitlement, TRIAL_RUN_LIMIT } from "../auth/entitlement.ts";
import { billingConfig, storedLivemode, type BillingConfig } from "./config.ts";
import { currentSubscription, resolveEntitlement, subscriptionStanding, type BillingEntitlement, type SubscriptionRow } from "./entitlement.ts";
import { supabaseBillingStore } from "./supabase-store.ts";

const PAGE = 1000;

export interface BillingView {
  config: Pick<BillingConfig, "active" | "reason" | "mode" | "automaticTax" | "taxIdCollection" | "graceDays">;
  /** A Stripe customer exists for this workspace, so the portal can open. */
  hasCustomer: boolean;
  entitlement: BillingEntitlement;
  subscriptions: SubscriptionRow[];
  /** Which plan keys have a Stripe price on the server's allow-list. Never the price id. */
  sellablePlans: string[];
  /** The owner's trial runs (every workspace they own), when this workspace has no model key. */
  trial: { used: number; limit: number } | null;
}

/**
 * Every run since `from`, and which of them were graded on Novera's keys (anything not on the
 * workspace's own key, the cautious reading), paged so PostgREST's row cap can never turn into
 * an undercount.
 */
async function runTimesSince(db: SupabaseClient, workspaceId: string, from: string | null): Promise<{ all: string[]; managed: string[] }> {
  const all: string[] = [];
  const managed: string[] = [];
  if (!from) return { all, managed };
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db.from("runs").select("created_at, judge_source")
      .eq("workspace_id", workspaceId).gte("created_at", from)
      .order("created_at", { ascending: true }).order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`Could not count runs: ${error.message}`);
    for (const r of data ?? []) {
      all.push(r.created_at as string);
      if (r.judge_source !== "workspace_key") managed.push(r.created_at as string);
    }
    if ((data ?? []).length < PAGE) return { all, managed };
  }
}

/** What the Billing page shows, computed on the server from stored rows. */
export async function loadBillingView(db: SupabaseClient, workspaceId: string, now = new Date()): Promise<BillingView> {
  const config = billingConfig();
  const store = supabaseBillingStore(db);
  const livemode = storedLivemode(config);
  const [base, stored, grants, customer, { count: totalRuns, error: countError }] = await Promise.all([
    workspaceEntitlement({ client: db, workspaceId }),
    store.listSubscriptions(workspaceId, livemode),
    store.listGrants(workspaceId),
    store.customerForWorkspace(workspaceId, livemode),
    db.from("runs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
  ]);
  if (countError) throw new Error(`Could not count runs: ${countError.message}`);

  const subscriptions: SubscriptionRow[] = stored.map((s) => ({
    stripeSubscriptionId: s.stripeSubscriptionId,
    status: s.status,
    planKey: s.planKey,
    currentPeriodStart: s.currentPeriodStart,
    currentPeriodEnd: s.currentPeriodEnd,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    cancelAt: s.cancelAt,
    delinquentSince: s.delinquentSince,
    stripeCreatedAt: s.stripeCreatedAt,
  }));

  // The earliest window any source counts from.
  const starts = [
    subscriptionStanding(currentSubscription(subscriptions), now, config.graceDays)?.periodStart ?? null,
    ...grants.filter((g) => !g.revokedAt).map((g) => g.startsAt),
  ].filter((x): x is string => Boolean(x)).sort();
  const runs = await runTimesSince(db, workspaceId, starts[0] ?? null);

  const entitlement = resolveEntitlement({
    now,
    graceDays: config.graceDays,
    trialRunsUsed: base.ownKey ? 0 : base.runsUsed,
    trialLimit: TRIAL_RUN_LIMIT,
    byok: { connected: base.ownKey, routable: base.ownKey && base.canRun, provider: base.provider },
    byokRequiresPlan: false,
    subscriptions,
    grants,
    runTimes: runs.all,
    managedRunTimes: runs.managed,
    totalRuns: totalRuns ?? 0,
  });

  return {
    config: {
      active: config.active, reason: config.reason, mode: config.mode,
      automaticTax: config.automaticTax, taxIdCollection: config.taxIdCollection, graceDays: config.graceDays,
    },
    hasCustomer: Boolean(customer),
    entitlement,
    subscriptions,
    sellablePlans: Object.keys(config.prices),
    trial: base.ownKey ? null : { used: base.runsUsed, limit: TRIAL_RUN_LIMIT },
  };
}
