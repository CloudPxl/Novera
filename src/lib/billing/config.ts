/**
 * Whether billing is on, in which Stripe mode, and with what — read from the environment once,
 * as a pure function of it so tests can hand it any environment.
 *
 * Billing is "not active" unless a secret key AND a webhook signing secret are set. A live key
 * (`sk_live_` / `rk_live_`) is refused unless `BILLING_ALLOW_LIVE=1`, and that variable must
 * stay unset until David has signed off live activation (docs/BILLING-DECISIONS.md): a live key
 * pasted into the wrong environment then turns billing off instead of charging someone.
 *
 * Nothing here is ever sent to a browser. The page reads `active`, `mode` and `reason` only.
 */
import { PLAN_KEYS, type PlanKey } from "./plans.ts";

export type BillingMode = "test" | "live";

export interface BillingConfig {
  active: boolean;
  /** Why billing is off, in words for the settings page. Null when active. */
  reason: string | null;
  mode: BillingMode | null;
  secretKey: string | null;
  webhookSecret: string | null;
  /** The server-side price allow-list: plan key → Stripe price id. Only these can be sold. */
  prices: Partial<Record<PlanKey, string>>;
  /** Stripe Tax on Checkout. Off until the tax registration decisions are made. */
  automaticTax: boolean;
  /** Ask for a business tax ID (VAT number) on Checkout. Off by default. */
  taxIdCollection: boolean;
  /** Days a past-due subscription keeps its allowance before the workspace is restricted. */
  graceDays: number;
  /** Optional Billing Portal configuration id (bpc_…); Stripe's default when unset. */
  portalConfiguration: string | null;
}

export const DEFAULT_GRACE_DAYS = 7;

const PRICE_ENV: Record<PlanKey, string> = {
  team_byok: "STRIPE_PRICE_TEAM_BYOK",
  agency_pro: "STRIPE_PRICE_AGENCY_PRO",
};

function flag(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

export function billingConfig(env: Record<string, string | undefined> = process.env): BillingConfig {
  const secretKey = env.STRIPE_SECRET_KEY?.trim() || null;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() || null;
  const grace = Number.parseInt(env.BILLING_GRACE_DAYS ?? "", 10);
  const prices: Partial<Record<PlanKey, string>> = {};
  for (const key of PLAN_KEYS) {
    const price = env[PRICE_ENV[key]]?.trim();
    if (price && /^price_[A-Za-z0-9]{1,64}$/.test(price)) prices[key] = price;
  }
  const portal = env.STRIPE_PORTAL_CONFIGURATION?.trim();

  const base = {
    prices,
    automaticTax: flag(env.BILLING_AUTOMATIC_TAX),
    taxIdCollection: flag(env.BILLING_TAX_ID_COLLECTION),
    graceDays: Number.isFinite(grace) && grace >= 0 && grace <= 30 ? grace : DEFAULT_GRACE_DAYS,
    portalConfiguration: portal && /^bpc_[A-Za-z0-9]{1,64}$/.test(portal) ? portal : null,
  };
  const off = (reason: string, mode: BillingMode | null = null): BillingConfig => ({
    ...base, active: false, reason, mode, secretKey: null, webhookSecret: null,
  });

  if (!secretKey || !webhookSecret) return off("Billing is not active yet: Novera has no payment provider configured.");

  const mode = keyMode(secretKey);
  if (!mode) return off("Billing is not active: the configured payment key is not a Stripe secret key.");
  if (mode === "live" && !flag(env.BILLING_ALLOW_LIVE)) {
    return off("Billing is not active: a live payment key is configured, and live billing has not been approved.", "live");
  }
  if (!webhookSecret.startsWith("whsec_")) return off("Billing is not active: the webhook signing secret is not a Stripe one.", mode);

  return { ...base, active: true, reason: null, mode, secretKey, webhookSecret };
}

/** `sk_test_` / `rk_test_` → test, `sk_live_` / `rk_live_` → live, anything else (a publishable key) → null. */
export function keyMode(key: string): BillingMode | null {
  if (/^(sk|rk)_test_/.test(key)) return "test";
  if (/^(sk|rk)_live_/.test(key)) return "live";
  return null;
}
