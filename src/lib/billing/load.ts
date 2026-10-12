import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { workspaceEntitlement, TRIAL_RUN_LIMIT } from "../auth/entitlement.ts";
import { billingConfig, storedLivemode, type BillingConfig } from "./config.ts";
import type { BillingEntitlement, SubscriptionRow } from "./entitlement.ts";
import { loadBillingRows } from "./rows.ts";
import { supabaseBillingStore } from "./supabase-store.ts";

export interface BillingView {
  config: Pick<BillingConfig, "active" | "reason" | "mode" | "automaticTax" | "taxIdCollection" | "graceDays">;
  /** A Stripe customer exists for this workspace, so the portal can open. */
  hasCustomer: boolean;
  entitlement: BillingEntitlement;
  subscriptions: SubscriptionRow[];
  /** Which plan keys have a Stripe price on the server's allow-list. Never the price id. */
  sellablePlans: string[];
  /** The owner's trial runs (every workspace they own). */
  trial: { used: number; limit: number };
  /** The workspace has its own model key stored. */
  ownKey: boolean;
  /** Fair use, as counted now: runs in flight and runs in the window. */
  usage: { inFlight: number; inWindow: number };
}

/**
 * What the Billing page shows, computed on the server from stored rows — the same decision a
 * run start makes (`workspaceEntitlement`), so the page never says one thing while the run
 * button does another.
 */
export async function loadBillingView(db: SupabaseClient, workspaceId: string, now = new Date()): Promise<BillingView> {
  const config = billingConfig();
  const [base, rows, customer] = await Promise.all([
    workspaceEntitlement({ client: db, workspaceId, now }),
    loadBillingRows(db, workspaceId, now),
    supabaseBillingStore(db).customerForWorkspace(workspaceId, storedLivemode(config)),
  ]);

  return {
    config: {
      active: config.active, reason: config.reason, mode: config.mode,
      automaticTax: config.automaticTax, taxIdCollection: config.taxIdCollection, graceDays: config.graceDays,
    },
    hasCustomer: Boolean(customer),
    entitlement: base.billing,
    subscriptions: rows.subscriptions,
    sellablePlans: Object.keys(config.prices),
    trial: { used: base.runsUsed, limit: TRIAL_RUN_LIMIT },
    ownKey: base.ownKey,
    usage: { inFlight: rows.runsInFlight, inWindow: rows.runsInWindow },
  };
}
