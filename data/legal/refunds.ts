/**
 * Refunds and cancellation — PLACEHOLDER, contingent on the commercial model.
 *
 * Sources consulted (read 2026-10-09): OUG 34/2014 Articles 2, 9 and 16 (a consumer's
 * 14-day withdrawal from a distance contract and its exception), relevant only if
 * consumers can buy; Regulation (EU) 2024/3228 (the ODR platform no longer exists).
 * Nothing is sold today, so nothing here is a commitment.
 */
import type { LegalDocument } from "./types.ts";

export const refunds: LegalDocument = {
  slug: "refunds",
  title: "Refunds and cancellation",
  summary: "A placeholder until prices and plans are decided. Nothing is sold today.",
  status: "draft",
  version: "0.1 draft",
  lastReviewed: "2026-10-09",
  sources: ["ro-oug-34-2014", "odr-repeal"],
  body: `Novera does not sell anything yet. The trial is free and no payment details are collected. This page will be written when the commercial model is decided.

## Decisions required before this page can be written

- [PLANS AND BILLING PERIOD: FOR EXAMPLE MONTHLY OR ANNUAL SUBSCRIPTION, OR PAYMENT PER VERIFIED RUN.]
- [HOW TO CANCEL, AND WHEN A CANCELLATION TAKES EFFECT.]
- [WHETHER ANY REFUND IS GIVEN FOR AN UNUSED PERIOD OR FOR A RUN THAT ERRORED, AND HOW IT IS REQUESTED.]
- [WHETHER CONSUMERS MAY BUY. IF THEY MAY, A 14-DAY WITHDRAWAL RIGHT FOR DISTANCE CONTRACTS, ITS EXCEPTIONS, A WITHDRAWAL FORM AND ANY ONLINE WITHDRAWAL FUNCTION MUST BE ADDRESSED — COUNSEL TO CONFIRM.]
- [TAX ON REFUNDS AND CREDIT NOTES — ACCOUNTANT TO CONFIRM.]

## Until then

Erasing a workspace or deleting an account is available at any time under Settings, at no cost.`,
};
