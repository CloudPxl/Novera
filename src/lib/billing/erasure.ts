import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { billingConfig } from "./config.ts";
import { currentSubscription, subscriptionStanding, type SubscriptionRow } from "./entitlement.ts";
import { supabaseBillingStore } from "./supabase-store.ts";

/**
 * Whether erasing this workspace would leave a Stripe subscription charging for it.
 *
 * Erasure removes the workspace's billing rows with everything else (0060–0062), but not the
 * subscription in Stripe — which would go on renewing for a workspace that no longer exists. So
 * erasure is refused, with the sentence to show, while a subscription would still renew: active,
 * trialing, or in its payment grace period. One set to end at period end does not block: nothing
 * more will be charged. Cancelling immediately (and any refund) is a billing decision for a
 * person, not something erasure does on its own (docs/BILLING-DECISIONS.md).
 */
export async function subscriptionBlocksErasure(admin: SupabaseClient, workspaceId: string, workspaceName: string): Promise<string | null> {
  const stored = await supabaseBillingStore(admin).listSubscriptions(workspaceId);
  const rows: SubscriptionRow[] = stored.map((s) => ({
    stripeSubscriptionId: s.stripeSubscriptionId, status: s.status, planKey: s.planKey,
    currentPeriodStart: s.currentPeriodStart, currentPeriodEnd: s.currentPeriodEnd,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd, cancelAt: s.cancelAt, delinquentSince: s.delinquentSince,
    stripeCreatedAt: s.stripeCreatedAt,
  }));
  const standing = subscriptionStanding(currentSubscription(rows), new Date(), billingConfig().graceDays);
  if (!standing || !["active", "trialing", "grace"].includes(standing.standing)) return null;
  return `${workspaceName} has a subscription that would keep renewing. Cancel it under Settings → Billing first (it ends at the close of the paid period), then erase the workspace.`;
}
