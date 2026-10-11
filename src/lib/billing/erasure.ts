import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { billingConfig, storedLivemode } from "./config.ts";
import { currentSubscription, subscriptionMayCharge, type SubscriptionRow } from "./entitlement.ts";
import { supabaseBillingStore } from "./supabase-store.ts";

/**
 * Whether erasing this workspace would leave a Stripe subscription charging for it.
 *
 * Erasure removes the workspace's billing rows with everything else (0060–0062), but not the
 * subscription in Stripe — which would go on renewing for a workspace that no longer exists. So
 * erasure is refused, with the sentence to show, while Stripe could still charge for it
 * (`subscriptionMayCharge`): active, trialing, past due, unpaid, incomplete or paused. One set to
 * end at period end does not block: nothing more will be charged. Only the configured Stripe
 * mode's rows are read, so a sandbox subscription never blocks erasure in production. Cancelling immediately (and any refund) is a billing decision for a
 * person, not something erasure does on its own (docs/BILLING-DECISIONS.md).
 */
export async function subscriptionBlocksErasure(admin: SupabaseClient, workspaceId: string, workspaceName: string): Promise<string | null> {
  const config = billingConfig();
  const stored = await supabaseBillingStore(admin).listSubscriptions(workspaceId, storedLivemode(config));
  const rows: SubscriptionRow[] = stored.map((s) => ({
    stripeSubscriptionId: s.stripeSubscriptionId, status: s.status, planKey: s.planKey,
    currentPeriodStart: s.currentPeriodStart, currentPeriodEnd: s.currentPeriodEnd,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd, cancelAt: s.cancelAt, delinquentSince: s.delinquentSince,
    stripeCreatedAt: s.stripeCreatedAt,
  }));
  if (!subscriptionMayCharge(currentSubscription(rows), new Date(), config.graceDays)) return null;
  return config.active
    ? `${workspaceName} has a subscription Stripe could still charge for. Cancel it under Settings → Billing first (it ends at the close of the paid period), then erase the workspace.`
    : `${workspaceName} has a subscription Stripe could still charge for, and billing is not open here to cancel it. Contact support to cancel it, then erase the workspace.`;
}
