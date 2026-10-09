/**
 * The billing tables (0060) as the webhook and the actions use them. An interface so the
 * webhook can be tested offline against an in-memory store (tests/billing-fakes.ts) and run
 * in production against Postgres (supabase-store.ts), with the same rules decided here.
 */
import type { GrantRow } from "./entitlement.ts";

export interface StoredSubscription {
  workspaceId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: string;
  planKey: string | null;
  stripePriceId: string | null;
  quantity: number | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  canceledAt: string | null;
  endedAt: string | null;
  delinquentSince: string | null;
  livemode: boolean;
  stripeCreatedAt: string;
  /** When this state was true at Stripe. Never moves backwards (enforced in 0060 too). */
  stripeObservedAt: string;
}

export type ClaimResult = "claimed" | "duplicate" | "busy";
export type EventOutcome = "processed" | "ignored" | "refused" | "failed";
export type WriteResult = "written" | "unchanged" | "stale" | "terminal";

export interface BillingEventLine {
  workspaceId: string;
  actorId: string | null;
  source: "stripe" | "member" | "staff" | "system";
  action: string;
  stripeEventId?: string | null;
  stripeObjectId?: string | null;
  /** Ids, statuses, plan keys. Never an email, an address, an amount or a secret. */
  detail?: Record<string, unknown>;
}

export interface BillingStore {
  /** Records the event id once. A second delivery of a finished event is a duplicate. */
  claimEvent(event: { id: string; type: string; livemode: boolean; createdAt: string }, now: Date): Promise<ClaimResult>;
  finishEvent(id: string, outcome: EventOutcome, detail: string | null, workspaceId: string | null): Promise<void>;
  workspaceForCustomer(stripeCustomerId: string): Promise<string | null>;
  customerForWorkspace(workspaceId: string): Promise<{ stripeCustomerId: string; livemode: boolean } | null>;
  /** Inserts the mapping; returns the mapping that is stored afterwards (a race keeps the first). */
  saveCustomer(row: { workspaceId: string; stripeCustomerId: string; livemode: boolean; createdBy: string | null }): Promise<{ stripeCustomerId: string }>;
  getSubscription(stripeSubscriptionId: string): Promise<StoredSubscription | null>;
  listSubscriptions(workspaceId: string): Promise<StoredSubscription[]>;
  /** Writes the state and its history line, unless it is older than, or contradicts, what is stored. */
  writeSubscription(row: StoredSubscription, eventId: string | null): Promise<WriteResult>;
  listGrants(workspaceId: string): Promise<GrantRow[]>;
  recordEvent(line: BillingEventLine): Promise<void>;
}

/** Statuses after which Stripe never changes a subscription again. */
export const TERMINAL_STATUSES = new Set(["canceled", "incomplete_expired"]);

const SAME_FIELDS: Array<keyof StoredSubscription> = [
  "status", "planKey", "stripePriceId", "quantity", "currentPeriodStart", "currentPeriodEnd",
  "cancelAtPeriodEnd", "cancelAt", "canceledAt", "endedAt", "delinquentSince",
];

/**
 * Whether `incoming` may replace `existing`. The same rule 0060's trigger enforces, decided
 * here first so a refused write is an outcome, not an exception:
 *   - an older observation never replaces a newer one (Stripe does not order its events);
 *   - a canceled or incomplete_expired subscription never changes status again;
 *   - the same state is not written twice (no history line for a duplicate).
 */
export function decideWrite(existing: StoredSubscription | null, incoming: StoredSubscription): WriteResult | "write" {
  if (!existing) return "write";
  if (Date.parse(incoming.stripeObservedAt) < Date.parse(existing.stripeObservedAt)) return "stale";
  if (TERMINAL_STATUSES.has(existing.status) && incoming.status !== existing.status) return "terminal";
  if (SAME_FIELDS.every((f) => existing[f] === incoming[f])) return "unchanged";
  return "write";
}
