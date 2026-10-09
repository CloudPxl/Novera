import "server-only";
import Stripe from "stripe";
import type { BillingConfig } from "./config.ts";
import type { CheckoutRequest, StripeGateway } from "./gateway.ts";

/**
 * The official SDK behind `StripeGateway`. Created only when billing is active, so a missing
 * or refused key never builds a client. The SDK pins its own API version (2026-09-30.endive
 * for stripe@23.0.0); the webhook destination should be created on the same version.
 */
export function stripeGateway(config: BillingConfig): StripeGateway | null {
  if (!config.active || !config.secretKey) return null;
  const stripe = new Stripe(config.secretKey, {
    maxNetworkRetries: 2,
    // Inside a 60 s function: a Stripe call that hangs must not hold the request.
    timeout: 15_000,
    appInfo: { name: "Novera" },
  });

  return {
    async retrieveSubscription(id) {
      return stripe.subscriptions.retrieve(id);
    },

    async createCustomer({ workspaceId, name, idempotencyKey }) {
      // No email, no address: Checkout collects what Stripe needs, on Stripe's page.
      const customer = await stripe.customers.create(
        { name, metadata: { workspace_id: workspaceId } },
        { idempotencyKey },
      );
      return { id: customer.id, livemode: customer.livemode };
    },

    async createCheckoutSession(req: CheckoutRequest) {
      const taxing = req.automaticTax || req.taxIdCollection;
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: req.customer,
        client_reference_id: req.workspaceId,
        line_items: [{ price: req.priceId, quantity: 1 }],
        metadata: { workspace_id: req.workspaceId, plan_key: req.planKey },
        subscription_data: { metadata: { workspace_id: req.workspaceId, plan_key: req.planKey } },
        success_url: req.successUrl,
        cancel_url: req.cancelUrl,
        ...(req.automaticTax ? { automatic_tax: { enabled: true } } : {}),
        ...(req.taxIdCollection ? { tax_id_collection: { enabled: true } } : {}),
        // An existing customer needs Checkout's name and address saved for tax and tax IDs.
        ...(taxing ? { billing_address_collection: "required" as const, customer_update: { name: "auto" as const, address: "auto" as const } } : {}),
      });
      return { id: session.id, url: session.url };
    },

    async createPortalSession({ customer, returnUrl, configuration }) {
      const session = await stripe.billingPortal.sessions.create({
        customer,
        return_url: returnUrl,
        ...(configuration ? { configuration } : {}),
      });
      return { url: session.url };
    },

    async setCancelAtPeriodEnd(subscriptionId, cancel) {
      await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: cancel });
    },
  };
}
