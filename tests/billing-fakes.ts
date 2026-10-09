/**
 * Offline stand-ins for the billing tests: an in-memory store with 0060's rules, a fake Stripe
 * that holds "the current state" of each subscription, and signed event builders. Nothing here
 * reaches Stripe's network.
 */
import Stripe from "stripe";
import type { GrantRow } from "../src/lib/billing/entitlement.ts";
import type { CheckoutRequest, StripeGateway } from "../src/lib/billing/gateway.ts";
import {
  TERMINAL_STATUSES, type BillingEventLine, type BillingStore, type ClaimResult, type EventOutcome,
  type StoredSubscription, type WriteResult,
} from "../src/lib/billing/store.ts";

export const SECRET = "whsec_test_novera_billing";

export class MemoryStore implements BillingStore {
  events = new Map<string, { status: "processing" | EventOutcome; attempts: number; detail: string | null; workspaceId: string | null }>();
  customers = new Map<string, { workspaceId: string; livemode: boolean }>(); // by customer id
  subscriptions = new Map<string, StoredSubscription>();
  history: Array<StoredSubscription & { eventId: string | null }> = [];
  trail: BillingEventLine[] = [];
  grants: Array<GrantRow & { workspaceId: string }> = [];

  async claimEvent(event: { id: string }): Promise<ClaimResult> {
    const found = this.events.get(event.id);
    if (!found) {
      this.events.set(event.id, { status: "processing", attempts: 1, detail: null, workspaceId: null });
      return "claimed";
    }
    if (found.status === "failed") {
      found.status = "processing";
      found.attempts++;
      return "claimed";
    }
    return found.status === "processing" ? "busy" : "duplicate";
  }

  async finishEvent(id: string, outcome: EventOutcome, detail: string | null, workspaceId: string | null) {
    const e = this.events.get(id)!;
    if (e.status !== "processing") throw new Error("finished twice");
    Object.assign(e, { status: outcome, detail, workspaceId: workspaceId ?? e.workspaceId });
  }

  async workspaceForCustomer(customerId: string) {
    return this.customers.get(customerId)?.workspaceId ?? null;
  }

  async customerForWorkspace(workspaceId: string) {
    for (const [id, c] of this.customers) if (c.workspaceId === workspaceId) return { stripeCustomerId: id, livemode: c.livemode };
    return null;
  }

  async saveCustomer(row: { workspaceId: string; stripeCustomerId: string; livemode: boolean }) {
    const existing = await this.customerForWorkspace(row.workspaceId);
    if (existing) return { stripeCustomerId: existing.stripeCustomerId };
    this.customers.set(row.stripeCustomerId, { workspaceId: row.workspaceId, livemode: row.livemode });
    return { stripeCustomerId: row.stripeCustomerId };
  }

  async getSubscription(id: string) {
    const s = this.subscriptions.get(id);
    return s ? { ...s } : null;
  }

  async listSubscriptions(workspaceId: string) {
    return [...this.subscriptions.values()].filter((s) => s.workspaceId === workspaceId).map((s) => ({ ...s }));
  }

  /** The same refusals as 0060's trigger, so a test cannot pass on a write the database would refuse. */
  async writeSubscription(row: StoredSubscription, eventId: string | null): Promise<WriteResult> {
    const old = this.subscriptions.get(row.stripeSubscriptionId);
    const owner = this.customers.get(row.stripeCustomerId)?.workspaceId;
    if (owner !== row.workspaceId) throw new Error("billing_subscriptions.stripe_customer_id must belong to the same workspace");
    if (old) {
      if (old.workspaceId !== row.workspaceId) throw new Error("workspace fixed");
      if (Date.parse(row.stripeObservedAt) < Date.parse(old.stripeObservedAt)) return "stale";
      if (TERMINAL_STATUSES.has(old.status) && row.status !== old.status) return "terminal";
    }
    this.subscriptions.set(row.stripeSubscriptionId, { ...row });
    this.history.push({ ...row, eventId });
    return "written";
  }

  async listGrants(workspaceId: string) {
    return this.grants.filter((g) => g.workspaceId === workspaceId);
  }

  async recordEvent(line: BillingEventLine) {
    this.trail.push(line);
  }
}

/** Stripe as it is "now": what `retrieveSubscription` returns. */
export class FakeStripe implements StripeGateway {
  current = new Map<string, Record<string, unknown>>();
  calls: string[] = [];
  failNextRetrieve = false;

  async retrieveSubscription(id: string) {
    this.calls.push(`retrieve ${id}`);
    if (this.failNextRetrieve) {
      this.failNextRetrieve = false;
      throw new Error("Stripe is unreachable (simulated)");
    }
    const s = this.current.get(id);
    if (!s) throw new Error(`No such subscription: ${id}`);
    return structuredClone(s);
  }
  async createCustomer(args: { workspaceId: string }) {
    this.calls.push(`customer ${args.workspaceId}`);
    return { id: `cus_${args.workspaceId.replace(/\W/g, "")}`, livemode: false };
  }
  async createCheckoutSession(req: CheckoutRequest) {
    this.calls.push(`checkout ${req.priceId}`);
    return { id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" };
  }
  async createPortalSession() {
    this.calls.push("portal");
    return { url: "https://billing.stripe.com/p/session/test_1" };
  }
  async setCancelAtPeriodEnd(id: string, cancel: boolean) {
    this.calls.push(`cancel ${id} ${cancel}`);
  }
}

export const T0 = Date.parse("2026-10-01T00:00:00Z") / 1000;
export const DAY = 86_400;

export function subscription(o: {
  id?: string; customer?: string; status?: string; price?: string; created?: number;
  periodStart?: number; periodEnd?: number; cancelAtPeriodEnd?: boolean; workspace?: string; livemode?: boolean;
}): Record<string, unknown> {
  const periodStart = o.periodStart ?? T0;
  return {
    id: o.id ?? "sub_A1",
    object: "subscription",
    customer: o.customer ?? "cus_A",
    status: o.status ?? "active",
    created: o.created ?? T0,
    livemode: o.livemode ?? false,
    cancel_at_period_end: o.cancelAtPeriodEnd ?? false,
    cancel_at: null,
    canceled_at: null,
    ended_at: null,
    metadata: o.workspace ? { workspace_id: o.workspace } : {},
    items: {
      object: "list",
      data: [{
        id: "si_1", object: "subscription_item", quantity: 1,
        price: { id: o.price ?? "price_team", object: "price" },
        current_period_start: periodStart,
        current_period_end: o.periodEnd ?? periodStart + 30 * DAY,
      }],
    },
  };
}

let counter = 0;
export function signedEvent(type: string, object: Record<string, unknown>, o: { id?: string; created?: number; livemode?: boolean; secret?: string } = {}) {
  const payload = JSON.stringify({
    id: o.id ?? `evt_test${++counter}`,
    object: "event",
    type,
    created: o.created ?? Math.floor(Date.now() / 1000),
    livemode: o.livemode ?? false,
    api_version: "2026-09-30.endive",
    data: { object },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: o.secret ?? SECRET });
  return { rawBody: payload, signature };
}
