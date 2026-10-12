import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { billingConfig, storedLivemode, type BillingConfig } from "./config.ts";
import { currentSubscription, DAY_MS, subscriptionStanding, type GrantRow, type SubscriptionRow } from "./entitlement.ts";
import { FAIR_USE_WINDOW_DAYS } from "./limits.ts";
import { supabaseBillingStore } from "./supabase-store.ts";

const PAGE = 1000;

/** Everything `resolveEntitlement` needs that is not about the model key or the trial. */
export interface BillingRows {
  config: BillingConfig;
  subscriptions: SubscriptionRow[];
  grants: GrantRow[];
  runTimes: string[];
  managedRunTimes: string[];
  totalRuns: number;
  runsInFlight: number;
  runsInWindow: number;
}

/**
 * Every run since `from`, and which of them were graded on Novera's keys under a plan
 * (`plan_managed`, 0067), paged so PostgREST's row cap can never turn into an undercount.
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
      if (r.judge_source === "plan_managed") managed.push(r.created_at as string);
    }
    if ((data ?? []).length < PAGE) return { all, managed };
  }
}

/**
 * The billing rows of one workspace, for this deployment's Stripe mode only (0065). Read with
 * the service role — billing tables have no client policy (0060) — so the caller must already
 * have checked that the person belongs to `workspaceId`; every query is scoped to it.
 */
export async function loadBillingRows(db: SupabaseClient, workspaceId: string, now = new Date()): Promise<BillingRows> {
  const config = billingConfig();
  const store = supabaseBillingStore(db);
  const livemode = storedLivemode(config);
  const count = (q: PromiseLike<{ count: number | null; error: { message: string } | null }>) =>
    Promise.resolve(q).then(({ count: n, error }) => {
      if (error) throw new Error(`Could not count runs: ${error.message}`);
      return n ?? 0;
    });

  const [stored, grants, totalRuns, runsInFlight, runsInWindow] = await Promise.all([
    store.listSubscriptions(workspaceId, livemode),
    store.listGrants(workspaceId),
    count(db.from("runs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId)),
    count(db.from("runs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).in("status", ["queued", "running"])),
    count(db.from("runs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId)
      .gt("created_at", new Date(now.getTime() - FAIR_USE_WINDOW_DAYS * DAY_MS).toISOString())),
  ]);

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

  return { config, subscriptions, grants, runTimes: runs.all, managedRunTimes: runs.managed, totalRuns, runsInFlight, runsInWindow };
}
