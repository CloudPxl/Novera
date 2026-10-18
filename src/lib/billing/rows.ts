import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { billingConfig, storedLivemode, type BillingConfig } from "./config.ts";
import { currentSubscription, DAY_MS, grantInForce, subscriptionStanding, type GrantRow, type SubscriptionRow } from "./entitlement.ts";
import { ALLOWANCE_COLUMN } from "./allowance.ts";
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
 * Every run since `from` that uses an allowance, and which of them were graded on Novera's keys
 * under a plan (`plan_managed`, 0067), paged so PostgREST's row cap can never turn into an
 * undercount. A run aborted before it recorded any scenario uses none (0074, the same rule
 * runs_fair_use_and_funding counts under its lock); fair use counts it separately below.
 */
async function runTimesSince(db: SupabaseClient, workspaceId: string, from: string | null): Promise<{ all: string[]; managed: string[] }> {
  const all: string[] = [];
  const managed: string[] = [];
  if (!from) return { all, managed };
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db.from("runs").select("created_at, judge_source")
      .eq("workspace_id", workspaceId).gte("created_at", from).eq(ALLOWANCE_COLUMN, true)
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
 * Each owner-wide grant (0076) with the runs it has funded, in every workspace of its owner:
 * the runs that name it, except one aborted before it recorded a scenario — the count 0076 makes
 * under the pool lock. A one-workspace grant is returned as it is; its window is counted over
 * `runTimes`.
 */
export async function withPoolCounts(db: SupabaseClient, grants: GrantRow[]): Promise<GrantRow[]> {
  return Promise.all(grants.map(async (g) => {
    if (!g.ownerId) return g;
    const { count, error } = await db.from("runs").select("id", { count: "exact", head: true })
      .eq("funded_by_grant", g.id).eq(ALLOWANCE_COLUMN, true);
    if (error) throw new Error(`Could not count the pilot's runs: ${error.message}`);
    return { ...g, poolRunsUsed: count ?? 0 };
  }));
}

/**
 * The owner-wide grants a person holds and that are in force now, counted — what /workspaces
 * says a new client workspace will run under. Service role; the caller passes the signed-in
 * person's own id.
 */
export async function ownerPoolsInForce(db: SupabaseClient, ownerId: string, now = new Date()): Promise<GrantRow[]> {
  const { data, error } = await db.from("billing_entitlement_grants")
    .select("id, kind, plan_key, runs_allowed, starts_at, ends_at, revoked_at, owner_id")
    .eq("owner_id", ownerId).is("revoked_at", null);
  if (error) throw new Error(`Could not read grants: ${error.message}`);
  const grants: GrantRow[] = (data ?? []).map((g) => ({
    id: g.id as string,
    kind: g.kind as GrantRow["kind"],
    planKey: (g.plan_key as string | null) ?? null,
    runsAllowed: typeof g.runs_allowed === "number" ? g.runs_allowed : null,
    startsAt: g.starts_at as string,
    endsAt: (g.ends_at as string | null) ?? null,
    revokedAt: null,
    ownerId: g.owner_id as string,
  }));
  return withPoolCounts(db, grants.filter((g) => grantInForce(g, now)));
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

  // Fair use counts every start, an empty aborted one included (0074): it is a rate limit.
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

  // The earliest window any source counts from. An owner-wide grant (0076) has no window here:
  // it is counted across its owner's workspaces, by the runs that name it.
  const starts = [
    subscriptionStanding(currentSubscription(subscriptions), now, config.graceDays)?.periodStart ?? null,
    ...grants.filter((g) => !g.revokedAt && !g.ownerId).map((g) => g.startsAt),
  ].filter((x): x is string => Boolean(x)).sort();
  const [counted, runs] = await Promise.all([withPoolCounts(db, grants), runTimesSince(db, workspaceId, starts[0] ?? null)]);

  return { config, subscriptions, grants: counted, runTimes: runs.all, managedRunTimes: runs.managed, totalRuns, runsInFlight, runsInWindow };
}
