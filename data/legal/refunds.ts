/**
 * Refunds and cancellation — DRAFT for legal review.
 *
 * Sources consulted (read 2026-10-09): OUG 34/2014 Articles 2, 9 and 16 (a consumer's 14-day
 * withdrawal from a distance contract and its exception) — relevant only if consumers can buy,
 * which the draft Terms exclude; Regulation (EU) 2024/3228 (the ODR platform no longer exists).
 *
 * Version 0.2 (2026-10-13) follows the legal build brief's draft policy and what the billing
 * code does: monthly plans, cancellation at period end through Stripe's portal, entitlement only
 * from Stripe's signed webhook. Nothing is sold live yet.
 */
import type { LegalDocument } from "./types.ts";

export const refunds: LegalDocument = {
  slug: "refunds",
  title: "Refunds and cancellation",
  summary: "Monthly subscriptions for business customers, cancelled at period end, with how to raise a charge you think is wrong.",
  status: "draft",
  version: "0.2 draft",
  lastReviewed: "2026-10-13",
  sources: ["ro-oug-34-2014", "odr-repeal"],
  body: `**DRAFT — COUNSEL REVIEW REQUIRED.** Novera does not sell anything live yet. This text describes how billing works once it opens, and must match the final Terms and the Stripe portal's settings before it is published.

## Who this applies to

Novera is offered to business customers on a recurring subscription basis. [DECISION CONFIRMED INTERNALLY: BUSINESS CUSTOMERS ONLY. COUNSEL TO CONFIRM THAT NO CONSUMER WITHDRAWAL NOTICE IS NEEDED.] The trial's three runs are free and need no payment details.

## Billing and renewal

- Plans are billed monthly, in euros, in advance, through Stripe. [VAT DISPLAY — INCLUDING OR EXCLUDING VAT — ACCOUNTANT TO CONFIRM.]
- A subscription renews automatically each month until it is cancelled.
- A plan starts when Stripe confirms the payment, usually within a minute. Returning from Stripe's checkout page alone does not start it.

## Cancelling

Customers may cancel at any time through the billing portal (Settings → Billing). Cancellation takes effect at the end of the current paid month; the plan stays in force until then, and a cancellation can be undone before that date. Every run, report and export stays readable after a plan ends.

## Refunds

Unless mandatory law requires otherwise, subscription fees are charged in advance and are non-refundable. No refund or credit is given for unused time, unused runs or a cancellation part-way through a month, except where mandatory law requires it or Novera agrees otherwise in writing.

## A charge you think is wrong

If you believe a charge was made in error, contact [SUPPORT CONTACT] before opening a payment dispute. Include the billing email address, the invoice number, the date and a description of the issue. Novera will review the request in good faith and reply within [RESPONSE TIME].

## Payment failures

If a payment fails, Stripe retries it. The plan stays in force for a grace period of [GRACE PERIOD — 7 DAYS IN THE CURRENT CONFIGURATION, DECISION D5] from the first failure; after that, new runs stop until the payment method is updated. Nothing is deleted.

Nothing in this policy limits rights that cannot lawfully be excluded. [TAX ON REFUNDS AND CREDIT NOTES — ACCOUNTANT TO CONFIRM.]`,
};
