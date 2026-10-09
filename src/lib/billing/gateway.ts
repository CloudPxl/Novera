/**
 * The Stripe calls Novera makes, as an interface. Production uses `stripeGateway` (the official
 * SDK, server-only, in stripe-gateway.ts); tests pass a fake, so no test ever reaches Stripe.
 */

export interface CheckoutRequest {
  customer: string;
  priceId: string;
  workspaceId: string;
  planKey: string;
  successUrl: string;
  cancelUrl: string;
  automaticTax: boolean;
  taxIdCollection: boolean;
}

export interface StripeGateway {
  /** The subscription as Stripe has it now: the source of truth for every write. */
  retrieveSubscription(id: string): Promise<unknown>;
  createCustomer(args: { workspaceId: string; name: string; idempotencyKey: string }): Promise<{ id: string; livemode: boolean }>;
  createCheckoutSession(args: CheckoutRequest): Promise<{ id: string; url: string | null }>;
  createPortalSession(args: { customer: string; returnUrl: string; configuration: string | null }): Promise<{ url: string }>;
  setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<void>;
}
