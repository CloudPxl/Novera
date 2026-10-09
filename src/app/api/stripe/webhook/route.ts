import { billingConfig } from "@/lib/billing/config.ts";
import { stripeGateway } from "@/lib/billing/stripe-gateway.ts";
import { supabaseBillingStore } from "@/lib/billing/supabase-store.ts";
import { handleStripeWebhook } from "@/lib/billing/webhook.ts";
import { serviceClient } from "@/lib/supabase/service.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Stripe's webhook endpoint. The body is read as text and handed on untouched: the signature
 * is computed over the exact bytes Stripe sent, and parsing first would break it. Everything
 * else — verification, idempotency, ordering, the workspace mapping — is in
 * src/lib/billing/webhook.ts, where it is tested.
 */
export async function POST(request: Request) {
  const config = billingConfig();
  if (!config.active) {
    return Response.json({ error: "Billing is not active." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const rawBody = await request.text();
  const result = await handleStripeWebhook({
    rawBody,
    signature: request.headers.get("stripe-signature"),
    config,
    store: supabaseBillingStore(serviceClient()),
    gateway: stripeGateway(config),
  });
  return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}

export function GET() {
  return Response.json({ error: "Use POST." }, { status: 405, headers: { Allow: "POST" } });
}
