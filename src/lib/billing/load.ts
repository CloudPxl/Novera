import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { workspaceEntitlement, TRIAL_RUN_LIMIT } from "../auth/entitlement.ts";
import { billingConfig, storedLivemode, type BillingConfig } from "./config.ts";
import { grantInForce, grantRunsUsed, type BillingEntitlement, type SubscriptionRow } from "./entitlement.ts";
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
  /**
   * Pilot grants in force now — redeemed from a code or granted by an operator — each counted the
   * way the entitlement counts a grant (`grantRunsUsed`), newest first. `shared`: one pool for
   * every workspace the owner owns (0076), as a pilot redeemed from a code is.
   */
  pilots: Array<{ grantId: string; runsAllowed: number; runsUsed: number; endsAt: string | null; shared: boolean }>;
  /**
   * When this workspace's owner redeemed a pilot code, in this workspace or another they own
   * (0076: one per owner). Null if they have not.
   */
  pilotRedeemedAt: string | null;
}

/** When the owner of `workspaceId` redeemed a pilot code, in any workspace they own (0076). */
async function ownerRedemption(db: SupabaseClient, workspaceId: string): Promise<string | null> {
  const { data: ws, error: wsError } = await db.from("workspaces").select("owner_id").eq("id", workspaceId).maybeSingle();
  if (wsError) throw new Error(`Could not read the workspace's owner: ${wsError.message}`);
  if (!ws?.owner_id) return null;
  const { data: owned, error: ownedError } = await db.from("workspaces").select("id").eq("owner_id", ws.owner_id as string);
  if (ownedError) throw new Error(`Could not read the owner's workspaces: ${ownedError.message}`);
  const { data, error } = await db.from("billing_pilot_code_redemptions").select("created_at")
    .in("workspace_id", (owned ?? []).map((w) => w.id as string)).order("created_at", { ascending: true }).limit(1);
  if (error) throw new Error(`Could not read the pilot code redemption: ${error.message}`);
  return (data?.[0]?.created_at as string | undefined) ?? null;
}

/**
 * What the Billing page shows, computed on the server from stored rows — the same decision a
 * run start makes (`workspaceEntitlement`), so the page never says one thing while the run
 * button does another.
 */
export async function loadBillingView(db: SupabaseClient, workspaceId: string, now = new Date()): Promise<BillingView> {
  const config = billingConfig();
  const [base, rows, customer, redeemedAt] = await Promise.all([
    workspaceEntitlement({ client: db, workspaceId, now }),
    loadBillingRows(db, workspaceId, now),
    supabaseBillingStore(db).customerForWorkspace(workspaceId, storedLivemode(config)),
    ownerRedemption(db, workspaceId),
  ]);
  const pilots = rows.grants
    .filter((g) => g.kind === "pilot" && g.runsAllowed !== null && grantInForce(g, now))
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .map((g) => ({ grantId: g.id, runsAllowed: g.runsAllowed!, runsUsed: grantRunsUsed(g, rows.runTimes), endsAt: g.endsAt, shared: Boolean(g.ownerId) }));

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
    pilots,
    pilotRedeemedAt: redeemedAt,
  };
}
