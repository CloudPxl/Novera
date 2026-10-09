/**
 * Stripe's webhook, as a function of (raw body, signature header, config, store, gateway).
 *
 * The rules, each one tested in tests/billing.test.ts:
 *   - The signature is checked over the raw body with the endpoint secret before anything is
 *     read or written. A bad or missing signature writes nothing.
 *   - An event whose mode (live/test) differs from the configured key's is refused.
 *   - Each event id is claimed once (0060 `billing_webhook_events`). A redelivery of a finished
 *     event does nothing and answers 200; one still being handled answers 409 so Stripe retries.
 *   - Nothing is written from the event's snapshot when Stripe can be asked: the subscription is
 *     fetched as Stripe has it now and written with that time. Stripe does not order its events
 *     and says not to order them by `created`, so a late, older event re-reads the current state
 *     instead of replaying an old one. Without a gateway (never in production) the snapshot is
 *     written with the event's time, and an older observation never replaces a newer one.
 *   - A Stripe object reaches a workspace only through `billing_customers`, the mapping Novera
 *     wrote when it created the customer. A session or subscription whose metadata or
 *     client_reference_id names another workspace is refused and logged.
 *   - The browser's return from Checkout grants nothing. Only these events change state.
 *   - No subscription change deletes anything; the most it does is stop counting a plan.
 */
import Stripe from "stripe";
import type { BillingConfig } from "./config.ts";
import type { StripeGateway } from "./gateway.ts";
import { planForPrice } from "./plans.ts";
import { decideWrite, type BillingStore, type EventOutcome, type StoredSubscription } from "./store.ts";
import { checkoutFacts, invoiceSubscriptionId, isoFromUnix, subscriptionFacts } from "./stripe-objects.ts";

export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
] as const;

export interface WebhookResult {
  status: number;
  body: { received?: true; duplicate?: true; outcome?: EventOutcome; error?: string };
}

interface Outcome {
  outcome: EventOutcome;
  detail: string | null;
  workspaceId: string | null;
}

export async function handleStripeWebhook(args: {
  rawBody: string;
  signature: string | null;
  config: BillingConfig;
  store: BillingStore;
  gateway: StripeGateway | null;
  now?: () => Date;
}): Promise<WebhookResult> {
  const { rawBody, signature, config, store, gateway } = args;
  const now = args.now ?? (() => new Date());

  if (!config.active || !config.webhookSecret) return { status: 503, body: { error: "Billing is not active." } };
  if (!signature) return { status: 400, body: { error: "Missing signature." } };

  let event: Stripe.Event;
  try {
    // Default tolerance (300 s): a replayed delivery older than that is refused.
    event = Stripe.webhooks.constructEvent(rawBody, signature, config.webhookSecret);
  } catch {
    // One answer for every failure: which part was wrong is nobody's business.
    return { status: 400, body: { error: "Signature verification failed." } };
  }

  if (event.livemode !== (config.mode === "live")) {
    return { status: 400, body: { error: "This endpoint does not accept events from that Stripe mode." } };
  }

  const claim = await store.claimEvent(
    { id: event.id, type: event.type, livemode: event.livemode, createdAt: isoFromUnix(event.created) ?? now().toISOString() },
    now(),
  );
  if (claim === "duplicate") return { status: 200, body: { received: true, duplicate: true } };
  if (claim === "busy") return { status: 409, body: { error: "This event is being handled; retry later." } };

  let result: Outcome;
  try {
    result = await dispatch(event, { config, store, gateway, now });
  } catch (e) {
    const detail = (e instanceof Error ? e.message : "Unknown failure").slice(0, 300);
    await store.finishEvent(event.id, "failed", detail, null);
    // Non-2xx: Stripe retries, and the failed row may be claimed again.
    return { status: 500, body: { error: "The event could not be handled; Stripe will retry." } };
  }
  await store.finishEvent(event.id, result.outcome, result.detail, result.workspaceId);
  return { status: 200, body: { received: true, outcome: result.outcome } };
}

interface Ctx {
  config: BillingConfig;
  store: BillingStore;
  gateway: StripeGateway | null;
  now: () => Date;
}

async function dispatch(event: Stripe.Event, ctx: Ctx): Promise<Outcome> {
  const object: unknown = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
      return checkoutCompleted(event, object, ctx);
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed": {
      const facts = subscriptionFacts(object);
      if (!facts) return { outcome: "ignored", detail: "Not a subscription object.", workspaceId: null };
      return syncSubscription(facts.id, object, event, ctx);
    }
    case "invoice.paid":
    case "invoice.payment_failed": {
      const subId = invoiceSubscriptionId(object);
      if (!subId) return { outcome: "ignored", detail: "Invoice without a subscription.", workspaceId: null };
      const synced = await syncSubscription(subId, null, event, ctx);
      if (synced.workspaceId && synced.outcome === "processed") {
        const invoiceId = typeof (object as { id?: unknown }).id === "string" ? (object as { id: string }).id : null;
        await ctx.store.recordEvent({
          workspaceId: synced.workspaceId, actorId: null, source: "stripe",
          action: event.type === "invoice.paid" ? "invoice.paid" : "invoice.payment_failed",
          stripeEventId: event.id, stripeObjectId: invoiceId, detail: { subscription: subId },
        });
      }
      return synced;
    }
    default:
      return { outcome: "ignored", detail: `Not an event Novera handles (${event.type}).`, workspaceId: null };
  }
}

async function refuse(ctx: Ctx, event: Stripe.Event, workspaceId: string | null, objectId: string, reason: string, detail: Record<string, unknown> = {}): Promise<Outcome> {
  if (workspaceId) {
    await ctx.store.recordEvent({
      workspaceId, actorId: null, source: "stripe", action: "webhook.refused",
      stripeEventId: event.id, stripeObjectId: objectId, detail: { reason, type: event.type, ...detail },
    });
  }
  return { outcome: "refused", detail: reason, workspaceId };
}

async function checkoutCompleted(event: Stripe.Event, object: unknown, ctx: Ctx): Promise<Outcome> {
  const session = checkoutFacts(object);
  if (!session) return { outcome: "ignored", detail: "Not a checkout session.", workspaceId: null };
  if (session.mode !== "subscription") return { outcome: "ignored", detail: "Not a subscription checkout.", workspaceId: null };
  if (!session.customerId) return { outcome: "refused", detail: "Checkout session without a customer.", workspaceId: null };

  const workspaceId = await ctx.store.workspaceForCustomer(session.customerId);
  if (!workspaceId) return { outcome: "refused", detail: "Checkout for a customer Novera did not create.", workspaceId: null };
  for (const named of [session.clientReferenceId, session.metadataWorkspaceId]) {
    if (named && named !== workspaceId) {
      return refuse(ctx, event, workspaceId, session.id, "The checkout names a different workspace than its customer belongs to.");
    }
  }

  await ctx.store.recordEvent({
    workspaceId, actorId: null, source: "stripe", action: "checkout.completed",
    stripeEventId: event.id, stripeObjectId: session.id,
    detail: { payment_status: session.paymentStatus, subscription: session.subscriptionId },
  });

  // The session itself grants nothing: the subscription's own status decides.
  if (!session.subscriptionId) return { outcome: "processed", detail: "Checkout completed without a subscription.", workspaceId };
  return syncSubscription(session.subscriptionId, null, event, ctx);
}

async function syncSubscription(subscriptionId: string, snapshot: unknown, event: Stripe.Event, ctx: Ctx): Promise<Outcome> {
  let object: unknown;
  let observedAt: string;
  if (ctx.gateway) {
    // The state now, whatever order the events arrive in.
    object = await ctx.gateway.retrieveSubscription(subscriptionId);
    observedAt = ctx.now().toISOString();
  } else if (snapshot) {
    object = snapshot;
    observedAt = isoFromUnix(event.created) ?? ctx.now().toISOString();
  } else {
    throw new Error("No Stripe client to read the subscription with.");
  }

  const facts = subscriptionFacts(object);
  if (!facts || facts.id !== subscriptionId) return { outcome: "failed", detail: "Stripe returned no readable subscription.", workspaceId: null };

  const workspaceId = await ctx.store.workspaceForCustomer(facts.customerId);
  if (!workspaceId) return { outcome: "refused", detail: "Subscription for a customer Novera did not create.", workspaceId: null };
  if (facts.metadataWorkspaceId && facts.metadataWorkspaceId !== workspaceId) {
    return refuse(ctx, event, workspaceId, facts.id, "The subscription names a different workspace than its customer belongs to.");
  }
  if (facts.livemode !== (ctx.config.mode === "live")) {
    return refuse(ctx, event, workspaceId, facts.id, "The subscription is from a different Stripe mode than the configured key.");
  }

  const existing = await ctx.store.getSubscription(facts.id);
  if (existing && existing.workspaceId !== workspaceId) {
    return refuse(ctx, event, workspaceId, facts.id, "The subscription is already recorded for another workspace.");
  }

  // The allow-list decides the plan; a price that is not on it is stored and grants nothing.
  let planKey = null as string | null;
  let priceId = null as string | null;
  for (const p of facts.priceIds) {
    const plan = planForPrice(p, ctx.config.prices);
    if (plan) { planKey = plan; priceId = p; break; }
  }
  if (!priceId) priceId = facts.priceIds[0] ?? null;

  const delinquent = facts.status === "past_due" || facts.status === "unpaid";
  const failedAt = event.type === "invoice.payment_failed" ? isoFromUnix(event.created) : null;
  const row: StoredSubscription = {
    workspaceId,
    stripeSubscriptionId: facts.id,
    stripeCustomerId: facts.customerId,
    status: facts.status,
    planKey,
    stripePriceId: priceId && /^price_[A-Za-z0-9]{1,64}$/.test(priceId) ? priceId : null,
    quantity: facts.quantity,
    currentPeriodStart: facts.currentPeriodStart,
    currentPeriodEnd: facts.currentPeriodEnd,
    cancelAtPeriodEnd: facts.cancelAtPeriodEnd,
    cancelAt: facts.cancelAt,
    canceledAt: facts.canceledAt,
    endedAt: facts.endedAt,
    // The grace period counts from the first failure of this delinquency and is not restarted by later ones.
    delinquentSince: delinquent ? (existing?.delinquentSince ?? failedAt ?? observedAt) : null,
    livemode: facts.livemode,
    stripeCreatedAt: facts.createdAt,
    stripeObservedAt: observedAt,
  };

  const decision = decideWrite(existing, row);
  if (decision === "stale") return { outcome: "processed", detail: "An older state than the one stored; not written.", workspaceId };
  if (decision === "terminal") return { outcome: "processed", detail: `The subscription already ended (${existing?.status}); not written.`, workspaceId };
  if (decision === "unchanged") return { outcome: "processed", detail: "No change.", workspaceId };

  const written = await ctx.store.writeSubscription(row, event.id);
  if (written !== "written") return { outcome: "processed", detail: `Not written (${written}).`, workspaceId };

  await ctx.store.recordEvent({
    workspaceId, actorId: null, source: "stripe",
    action: !planKey && facts.priceIds.length ? "subscription.unrecognised_price" : "subscription.synced",
    stripeEventId: event.id, stripeObjectId: facts.id,
    detail: {
      status: row.status, previous_status: existing?.status ?? null,
      plan_key: planKey, previous_plan_key: existing?.planKey ?? null,
      cancel_at_period_end: row.cancelAtPeriodEnd,
    },
  });
  return { outcome: "processed", detail: null, workspaceId };
}
