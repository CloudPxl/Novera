import type { Category } from "./types.ts";

/**
 * A target's category is derived from recorded facts, never chosen: an operator answers yes
 * or no to what the bot can reach, and the rule below decides. Pure, so the same decision is
 * made in the form, in the server action and in tests.
 *
 *   A  a public demo anyone may try: no login, no money, no real orders, accounts or refunds
 *   B  public, but it can touch real money, orders, bookings, accounts or refunds → owner authorisation
 *   C  behind a login → explicit authorisation and safe credentials (the staging-evaluation path)
 *   D  never: the owner declined, the site's terms prohibit automated access, or the bot handles
 *      sensitive personal data
 */
export interface TargetFacts {
  requires_login: boolean;
  handles_payments: boolean;
  places_real_orders_or_bookings: boolean;
  changes_real_accounts: boolean;
  issues_real_refunds: boolean;
  processes_sensitive_personal_data: boolean;
  terms_prohibit_automation: boolean;
  owner_declined: boolean;
}

export const FACT_KEYS = [
  "requires_login", "handles_payments", "places_real_orders_or_bookings", "changes_real_accounts",
  "issues_real_refunds", "processes_sensitive_personal_data", "terms_prohibit_automation", "owner_declined",
] as const satisfies ReadonlyArray<keyof TargetFacts>;

export const FACT_LABEL: Record<keyof TargetFacts, string> = {
  requires_login: "Using the bot needs an account or a login",
  handles_payments: "It can take or change a payment",
  places_real_orders_or_bookings: "It can place a real order or booking",
  changes_real_accounts: "It can change a real customer account",
  issues_real_refunds: "It can issue a real refund or cancellation",
  processes_sensitive_personal_data: "It handles sensitive personal data (health, finances, minors)",
  terms_prohibit_automation: "The site's terms prohibit automated access",
  owner_declined: "The owner has asked not to be tested",
};

/** Reads facts from form values or stored JSON; anything not plainly true is false. */
export function parseFacts(input: Record<string, unknown> | null | undefined): TargetFacts {
  const yes = (v: unknown) => v === true || v === "true" || v === "on" || v === "yes" || v === "1";
  const facts = {} as TargetFacts;
  for (const key of FACT_KEYS) facts[key] = yes(input?.[key]);
  return facts;
}

export const CATEGORY_LABEL: Record<Category, string> = {
  A: "Category A — public demo, scannable",
  B: "Category B — public but touches real money, orders or accounts; needs the owner's authorisation",
  C: "Category C — behind a login; needs explicit authorisation and safe credentials",
  D: "Category D — never tested",
};

export function classify(facts: TargetFacts): { category: Category; reasons: string[] } {
  const reasons: string[] = [];
  if (facts.owner_declined) reasons.push("The owner has asked not to be tested.");
  if (facts.terms_prohibit_automation) reasons.push("The site's terms prohibit automated access.");
  if (facts.processes_sensitive_personal_data) reasons.push("The bot handles sensitive personal data.");
  if (reasons.length) return { category: "D", reasons };

  if (facts.requires_login) {
    return { category: "C", reasons: ["Using the bot needs a login, so it reaches a real account."] };
  }

  if (facts.handles_payments) reasons.push("It can take or change a payment.");
  if (facts.places_real_orders_or_bookings) reasons.push("It can place a real order or booking.");
  if (facts.changes_real_accounts) reasons.push("It can change a real customer account.");
  if (facts.issues_real_refunds) reasons.push("It can issue a real refund or cancellation.");
  if (reasons.length) return { category: "B", reasons };

  return {
    category: "A",
    reasons: ["A public demo: no login, no payment, no real order, account change or refund behind the widget."],
  };
}
