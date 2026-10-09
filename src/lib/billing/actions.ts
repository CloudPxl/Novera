"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWorkspace, gate } from "@/lib/auth/session.ts";
import { recordAudit } from "@/lib/audit/record.ts";
import { appOrigin } from "@/lib/auth/redirects.ts";
import { billingConfig } from "./config.ts";
import { checkoutRequest, decideCheckout, isStripeHostedUrl } from "./checkout.ts";
import { currentSubscription, subscriptionStanding, type SubscriptionRow } from "./entitlement.ts";
import { stripeGateway } from "./stripe-gateway.ts";
import { supabaseBillingStore } from "./supabase-store.ts";

export interface BillingFormState {
  error?: string;
  notice?: string;
}

/**
 * Billing actions. Each one takes the workspace from the signed-in person's active workspace
 * (checked against live membership by `gate`, role `billing.manage`), never from the form.
 * None of them changes what the workspace may do: only Stripe's webhook does that.
 */

async function origin(): Promise<string> {
  return appOrigin((await headers()).get("origin"));
}

function rows(stored: Awaited<ReturnType<ReturnType<typeof supabaseBillingStore>["listSubscriptions"]>>): SubscriptionRow[] {
  return stored.map((s) => ({
    stripeSubscriptionId: s.stripeSubscriptionId, status: s.status, planKey: s.planKey,
    currentPeriodStart: s.currentPeriodStart, currentPeriodEnd: s.currentPeriodEnd,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd, cancelAt: s.cancelAt, delinquentSince: s.delinquentSince,
    stripeCreatedAt: s.stripeCreatedAt,
  }));
}

/** Starts a Stripe Checkout for one plan key from the server's allow-list. */
export async function startCheckout(_prev: BillingFormState, form: FormData): Promise<BillingFormState> {
  const { user, workspace } = await requireWorkspace();
  const gated = await gate(user.id, workspace.id, "billing.manage");
  if ("error" in gated) return { error: gated.error };
  const config = billingConfig();
  const gateway = stripeGateway(config);
  if (!config.active || !gateway) return { error: config.reason ?? "Billing is not active yet." };

  const store = supabaseBillingStore(gated.admin);
  // The only field read from the form. Anything else it carries is ignored.
  const decision = decideCheckout({ config, requestedPlan: form.get("plan"), subscriptions: rows(await store.listSubscriptions(workspace.id)) });
  if (!decision.ok) return { error: decision.error };

  let url: string | null;
  try {
    let customer = await store.customerForWorkspace(workspace.id);
    if (!customer) {
      // Idempotent at Stripe: two clicks at once create one customer.
      const created = await gateway.createCustomer({ workspaceId: workspace.id, name: workspace.name, idempotencyKey: `novera-customer-${workspace.id}` });
      const saved = await store.saveCustomer({ workspaceId: workspace.id, stripeCustomerId: created.id, livemode: created.livemode, createdBy: user.id });
      customer = { stripeCustomerId: saved.stripeCustomerId, livemode: created.livemode };
    }
    if (customer.livemode !== (config.mode === "live")) {
      return { error: "This workspace's billing record belongs to a different Stripe mode. Contact support." };
    }
    const session = await gateway.createCheckoutSession(checkoutRequest({
      config, decision, customer: customer.stripeCustomerId, workspaceId: workspace.id, origin: await origin(),
    }));
    url = session.url;
    await store.recordEvent({
      workspaceId: workspace.id, actorId: user.id, source: "member", action: "checkout.started",
      stripeObjectId: session.id, detail: { plan_key: decision.planKey, mode: config.mode },
    });
    await recordAudit(gated.admin, { workspaceId: workspace.id, actorId: user.id, action: "billing.checkout_started", detail: { plan: decision.planKey } });
  } catch (e) {
    return { error: `Checkout could not be started: ${e instanceof Error ? e.message : "unknown error"}` };
  }
  if (!isStripeHostedUrl(url, "checkout.stripe.com")) return { error: "Stripe did not return a checkout page." };
  redirect(url);
}

/** Opens Stripe's billing portal: payment method, invoices, plan changes, cancellation. */
export async function openBillingPortal(_prev: BillingFormState, _form: FormData): Promise<BillingFormState> {
  void _form;
  const { user, workspace } = await requireWorkspace();
  const gated = await gate(user.id, workspace.id, "billing.manage");
  if ("error" in gated) return { error: gated.error };
  const config = billingConfig();
  const gateway = stripeGateway(config);
  if (!config.active || !gateway) return { error: config.reason ?? "Billing is not active yet." };

  const store = supabaseBillingStore(gated.admin);
  const customer = await store.customerForWorkspace(workspace.id);
  if (!customer) return { error: "This workspace has no billing record yet. Choose a plan first." };

  let url: string;
  try {
    // Returning from the portal changes nothing here; Stripe's webhook carries any change.
    ({ url } = await gateway.createPortalSession({
      customer: customer.stripeCustomerId, returnUrl: `${await origin()}/settings/billing?portal=returned`, configuration: config.portalConfiguration,
    }));
    await recordAudit(gated.admin, { workspaceId: workspace.id, actorId: user.id, action: "billing.portal_opened", detail: {} });
  } catch (e) {
    return { error: `The billing portal could not be opened: ${e instanceof Error ? e.message : "unknown error"}` };
  }
  if (!isStripeHostedUrl(url, "billing.stripe.com")) return { error: "Stripe did not return a portal page." };
  redirect(url);
}

/** Asks Stripe to cancel at the end of the paid period, or withdraws that request. */
export async function setCancellation(_prev: BillingFormState, form: FormData): Promise<BillingFormState> {
  const { user, workspace } = await requireWorkspace();
  const gated = await gate(user.id, workspace.id, "billing.manage");
  if ("error" in gated) return { error: gated.error };
  const config = billingConfig();
  const gateway = stripeGateway(config);
  if (!config.active || !gateway) return { error: config.reason ?? "Billing is not active yet." };

  const cancel = form.get("cancel") === "yes";
  const store = supabaseBillingStore(gated.admin);
  // The subscription is this workspace's current one, read from our rows — never an id from the form.
  const current = currentSubscription(rows(await store.listSubscriptions(workspace.id)));
  const standing = subscriptionStanding(current, new Date(), config.graceDays);
  if (!current || !standing || !["active", "trialing", "cancelling", "grace"].includes(standing.standing)) {
    return { error: "There is no running subscription to change." };
  }
  try {
    await gateway.setCancelAtPeriodEnd(current.stripeSubscriptionId, cancel);
    await recordAudit(gated.admin, {
      workspaceId: workspace.id, actorId: user.id,
      action: cancel ? "billing.cancellation_scheduled" : "billing.cancellation_withdrawn", detail: {},
    });
  } catch (e) {
    return { error: `Stripe did not accept the change: ${e instanceof Error ? e.message : "unknown error"}` };
  }
  revalidatePath("/settings/billing");
  return { notice: cancel
    ? "Requested. The plan stays in force until the end of the paid period; this page shows it once Stripe confirms."
    : "Requested. The subscription continues; this page shows it once Stripe confirms." };
}
