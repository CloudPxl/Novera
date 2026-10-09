/**
 * Reading Stripe objects defensively. An event's snapshot and an object fetched from the API
 * have the same shape for the fields used here, but the API version decides where a field
 * lives: since 2025-03-31 a subscription's period is on its items and an invoice names its
 * subscription under `parent.subscription_details`. Both places are read, newest first.
 */

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** An expandable reference: either the id or an object carrying it. */
export function idOf(v: unknown): string | null {
  if (typeof v === "string") return v || null;
  if (isRec(v)) return str(v.id);
  return null;
}

/** Stripe's unix seconds as ISO, or null. */
export function isoFromUnix(v: unknown): string | null {
  const n = num(v);
  return n === null ? null : new Date(n * 1000).toISOString();
}

export interface SubscriptionFacts {
  id: string;
  customerId: string;
  status: string;
  livemode: boolean;
  createdAt: string;
  priceIds: string[];
  quantity: number | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  canceledAt: string | null;
  endedAt: string | null;
  metadataWorkspaceId: string | null;
}

export function subscriptionFacts(obj: unknown): SubscriptionFacts | null {
  if (!isRec(obj) || obj.object !== "subscription") return null;
  const id = str(obj.id);
  const customerId = idOf(obj.customer);
  const status = str(obj.status);
  const created = isoFromUnix(obj.created);
  if (!id || !customerId || !status || !created) return null;

  const items = isRec(obj.items) && Array.isArray(obj.items.data) ? (obj.items.data as unknown[]).filter(isRec) : [];
  const priceIds = items.map((i) => idOf(i.price)).filter((p): p is string => Boolean(p));
  const first = items[0];
  // The period: on the item since 2025-03-31.basil, on the subscription before it.
  const periodStart = isoFromUnix(first?.current_period_start) ?? isoFromUnix(obj.current_period_start);
  const periodEnd = isoFromUnix(first?.current_period_end) ?? isoFromUnix(obj.current_period_end);
  const metadata = isRec(obj.metadata) ? obj.metadata : {};

  return {
    id,
    customerId,
    status,
    livemode: obj.livemode === true,
    createdAt: created,
    priceIds,
    quantity: num(first?.quantity),
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: obj.cancel_at_period_end === true,
    cancelAt: isoFromUnix(obj.cancel_at),
    canceledAt: isoFromUnix(obj.canceled_at),
    endedAt: isoFromUnix(obj.ended_at),
    metadataWorkspaceId: str(metadata.workspace_id),
  };
}

/** The subscription an invoice belongs to, on any API version. */
export function invoiceSubscriptionId(obj: unknown): string | null {
  if (!isRec(obj)) return null;
  const parent = isRec(obj.parent) ? obj.parent : null;
  const details = parent && isRec(parent.subscription_details) ? parent.subscription_details : null;
  return idOf(details?.subscription) ?? idOf(obj.subscription);
}

export interface CheckoutFacts {
  id: string;
  mode: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  clientReferenceId: string | null;
  metadataWorkspaceId: string | null;
  status: string | null;
  paymentStatus: string | null;
}

export function checkoutFacts(obj: unknown): CheckoutFacts | null {
  if (!isRec(obj) || obj.object !== "checkout.session") return null;
  const id = str(obj.id);
  if (!id) return null;
  const metadata = isRec(obj.metadata) ? obj.metadata : {};
  return {
    id,
    mode: str(obj.mode),
    customerId: idOf(obj.customer),
    subscriptionId: idOf(obj.subscription),
    clientReferenceId: str(obj.client_reference_id),
    metadataWorkspaceId: str(metadata.workspace_id),
    status: str(obj.status),
    paymentStatus: str(obj.payment_status),
  };
}
