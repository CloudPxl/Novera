import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GrantRow } from "./entitlement.ts";
import type { BillingEventLine, BillingStore, ClaimResult, StoredSubscription, WriteResult } from "./store.ts";

/** A claim older than this with no outcome is treated as abandoned (a crashed function). */
const STALE_CLAIM_MS = 5 * 60_000;

const SUB_COLUMNS =
  "workspace_id, stripe_subscription_id, stripe_customer_id, status, plan_key, stripe_price_id, quantity, current_period_start, current_period_end, cancel_at_period_end, cancel_at, canceled_at, ended_at, delinquent_since, livemode, stripe_created_at, stripe_observed_at";

type Row = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v : null);

function fromRow(r: Row): StoredSubscription {
  return {
    workspaceId: r.workspace_id as string,
    stripeSubscriptionId: r.stripe_subscription_id as string,
    stripeCustomerId: r.stripe_customer_id as string,
    status: r.status as string,
    planKey: s(r.plan_key),
    stripePriceId: s(r.stripe_price_id),
    quantity: typeof r.quantity === "number" ? r.quantity : null,
    currentPeriodStart: iso(r.current_period_start),
    currentPeriodEnd: iso(r.current_period_end),
    cancelAtPeriodEnd: r.cancel_at_period_end === true,
    cancelAt: iso(r.cancel_at),
    canceledAt: iso(r.canceled_at),
    endedAt: iso(r.ended_at),
    delinquentSince: iso(r.delinquent_since),
    livemode: r.livemode === true,
    stripeCreatedAt: iso(r.stripe_created_at) as string,
    stripeObservedAt: iso(r.stripe_observed_at) as string,
  };
}

/** Postgres returns `+00:00` timestamps; compare in one format. */
function iso(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const n = Date.parse(v);
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
}

function toRow(sub: StoredSubscription): Row {
  return {
    workspace_id: sub.workspaceId,
    stripe_subscription_id: sub.stripeSubscriptionId,
    stripe_customer_id: sub.stripeCustomerId,
    status: sub.status,
    plan_key: sub.planKey,
    stripe_price_id: sub.stripePriceId,
    quantity: sub.quantity,
    current_period_start: sub.currentPeriodStart,
    current_period_end: sub.currentPeriodEnd,
    cancel_at_period_end: sub.cancelAtPeriodEnd,
    cancel_at: sub.cancelAt,
    canceled_at: sub.canceledAt,
    ended_at: sub.endedAt,
    delinquent_since: sub.delinquentSince,
    livemode: sub.livemode,
    stripe_created_at: sub.stripeCreatedAt,
    stripe_observed_at: sub.stripeObservedAt,
  };
}

/** The billing tables through the service role. Every write here is also guarded by 0060's triggers. */
export function supabaseBillingStore(db: SupabaseClient): BillingStore {
  const store: BillingStore = {
    async claimEvent(event, now): Promise<ClaimResult> {
      const { error } = await db.from("billing_webhook_events").insert({
        stripe_event_id: event.id, type: event.type, livemode: event.livemode, stripe_created_at: event.createdAt,
      });
      if (!error) return "claimed";
      if (error.code !== "23505") throw new Error(`Could not record the event: ${error.message}`);

      const { data, error: readError } = await db.from("billing_webhook_events")
        .select("status, attempts, claimed_at").eq("stripe_event_id", event.id).single();
      if (readError || !data) throw new Error(`Could not read the event: ${readError?.message ?? "missing"}`);
      if (["processed", "ignored", "refused"].includes(data.status as string)) return "duplicate";
      const stale = data.status === "processing" && now.getTime() - Date.parse(data.claimed_at as string) > STALE_CLAIM_MS;
      if (data.status !== "failed" && !stale) return "busy";
      // Reclaim, conditional on nobody else having reclaimed it first.
      const { data: claimed, error: claimError } = await db.from("billing_webhook_events")
        .update({ status: "processing", attempts: (data.attempts as number) + 1, claimed_at: now.toISOString() })
        .eq("stripe_event_id", event.id).eq("status", data.status as string).eq("claimed_at", data.claimed_at as string)
        .select("stripe_event_id");
      if (claimError) throw new Error(`Could not reclaim the event: ${claimError.message}`);
      return claimed?.length ? "claimed" : "busy";
    },

    async finishEvent(id, outcome, detail, workspaceId) {
      const { error } = await db.from("billing_webhook_events")
        .update({ status: outcome, detail: detail?.slice(0, 500) ?? null, finished_at: new Date().toISOString(), ...(workspaceId ? { workspace_id: workspaceId } : {}) })
        .eq("stripe_event_id", id).eq("status", "processing");
      if (error) throw new Error(`Could not finish the event: ${error.message}`);
    },

    async workspaceForCustomer(customerId) {
      const { data, error } = await db.from("billing_customers").select("workspace_id").eq("stripe_customer_id", customerId).maybeSingle();
      if (error) throw new Error(`Could not read the customer: ${error.message}`);
      return (data?.workspace_id as string | undefined) ?? null;
    },

    async customerForWorkspace(workspaceId) {
      const { data, error } = await db.from("billing_customers").select("stripe_customer_id, livemode").eq("workspace_id", workspaceId).maybeSingle();
      if (error) throw new Error(`Could not read the customer: ${error.message}`);
      return data ? { stripeCustomerId: data.stripe_customer_id as string, livemode: data.livemode as boolean } : null;
    },

    async saveCustomer(row) {
      const { error } = await db.from("billing_customers").insert({
        workspace_id: row.workspaceId, stripe_customer_id: row.stripeCustomerId, livemode: row.livemode, created_by: row.createdBy,
      });
      if (error && error.code !== "23505") throw new Error(`Could not save the customer: ${error.message}`);
      const stored = await store.customerForWorkspace(row.workspaceId);
      if (!stored) throw new Error("The customer was not saved.");
      return { stripeCustomerId: stored.stripeCustomerId };
    },

    async getSubscription(id) {
      const { data, error } = await db.from("billing_subscriptions").select(SUB_COLUMNS).eq("stripe_subscription_id", id).maybeSingle();
      if (error) throw new Error(`Could not read the subscription: ${error.message}`);
      return data ? fromRow(data as Row) : null;
    },

    async listSubscriptions(workspaceId) {
      const { data, error } = await db.from("billing_subscriptions").select(SUB_COLUMNS)
        .eq("workspace_id", workspaceId).order("stripe_created_at", { ascending: false });
      if (error) throw new Error(`Could not read subscriptions: ${error.message}`);
      return (data ?? []).map((r) => fromRow(r as Row));
    },

    async writeSubscription(sub, eventId): Promise<WriteResult> {
      const row = toRow(sub);
      const existing = await store.getSubscription(sub.stripeSubscriptionId);
      let error;
      if (!existing) {
        ({ error } = await db.from("billing_subscriptions").insert({ ...row, last_event_id: eventId }));
        // A concurrent first write: the other one won; ours is re-decided by the next event.
        if (error?.code === "23505") return "stale";
      } else {
        const { data, error: e } = await db.from("billing_subscriptions")
          .update({ ...row, last_event_id: eventId })
          .eq("stripe_subscription_id", sub.stripeSubscriptionId)
          .lte("stripe_observed_at", sub.stripeObservedAt)
          .select("stripe_subscription_id");
        error = e;
        if (!error && !data?.length) return "stale";
      }
      if (error) {
        if (/stale_subscription_state/.test(error.message)) return "stale";
        if (/terminal_subscription_state/.test(error.message)) return "terminal";
        throw new Error(`Could not write the subscription: ${error.message}`);
      }
      const { error: historyError } = await db.from("billing_subscription_history").insert({
        workspace_id: sub.workspaceId,
        stripe_subscription_id: sub.stripeSubscriptionId,
        status: sub.status,
        plan_key: sub.planKey,
        stripe_price_id: sub.stripePriceId,
        current_period_end: sub.currentPeriodEnd,
        cancel_at_period_end: sub.cancelAtPeriodEnd,
        delinquent_since: sub.delinquentSince,
        stripe_observed_at: sub.stripeObservedAt,
        stripe_event_id: eventId,
      });
      if (historyError) throw new Error(`Could not record the subscription's history: ${historyError.message}`);
      return "written";
    },

    async listGrants(workspaceId): Promise<GrantRow[]> {
      const { data, error } = await db.from("billing_entitlement_grants")
        .select("id, kind, plan_key, runs_allowed, starts_at, ends_at, revoked_at").eq("workspace_id", workspaceId);
      if (error) throw new Error(`Could not read grants: ${error.message}`);
      return (data ?? []).map((g) => ({
        id: g.id as string,
        kind: g.kind as GrantRow["kind"],
        planKey: s(g.plan_key),
        runsAllowed: typeof g.runs_allowed === "number" ? g.runs_allowed : null,
        startsAt: iso(g.starts_at) as string,
        endsAt: iso(g.ends_at),
        revokedAt: iso(g.revoked_at),
      }));
    },

    async recordEvent(line: BillingEventLine) {
      const { error } = await db.from("billing_events").insert({
        workspace_id: line.workspaceId,
        actor_id: line.actorId,
        source: line.source,
        action: line.action,
        stripe_event_id: line.stripeEventId ?? null,
        stripe_object_id: line.stripeObjectId ?? null,
        detail: line.detail ?? {},
      });
      // Thrown, like recordAudit: a billing change without its line is worse than a retry.
      if (error) throw new Error(`Could not record the billing event: ${error.message}`);
    },
  };
  return store;
}
