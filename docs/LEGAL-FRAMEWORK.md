# Legal framework: what is built, what waits on whom

This tracks the legal build brief of 2026-10-13 (Romania and EU, prepared for David). The brief is
not legal advice, and neither is anything here. Every legal text in `data/legal/` is still a draft:
**DRAFT — COUNSEL REVIEW REQUIRED**. What was built is the machinery around the texts:

- acceptance;
- business details;
- publication controls;
- the report notice;
- the provider register;
- the retention schedule.

None of it can make a draft look final.

Questions for the lawyer and the accountant are in `docs/LEGAL-COUNSEL-QUESTIONS.md` (36–42 were
added from the brief). Missing facts are in `docs/legal-inputs-required.md`.

## Brief section → implementation

| Brief | What exists | Where | Status |
|---|---|---|---|
| §2 Article 1203 acceptance | Three separate checkboxes, none pre-ticked: the documents; express acceptance of Terms §§2, 8, 10, 12, 14, 15, 17, each listed with what it covers; business purpose and authority. Each text is fingerprinted, and so is the unusual-clause text on its own | `src/lib/legal/contract.ts`, `src/app/(app)/settings/billing/terms-form.tsx` | Built; wording for counsel (question 36) |
| §3 B2B gate | Legal name, registered address, country (validated with the runtime's `Intl` region data), optional VAT number recorded as declared and never marked validated, signer name and title | same, 0068 | Built; adequacy for counsel (37) |
| §4 Consumer withdrawal | Not offered: B2B only. No consumer checkout and no 14-day copy | Terms §2, Refunds | Decision recorded; counsel to confirm |
| §5 Renewal, cancellation, refunds | Terms §10 and the Refunds draft describe what the code does: monthly renewal, cancellation at period end through Stripe's portal, a plan starts only on Stripe's signed webhook | `data/legal/terms.ts`, `refunds.ts` | Draft |
| §6–7 AI Act boundary and report notice | Standing notice: on every report's cover and in full, in the CSV, Markdown, JSON (`notice`, outside the hashed payload) and JUnit exports, beside the "Open the client report" link, and in the AI Testing Scope notice. New reports' sealed limitations also say "not a statutory conformity assessment; Novera is not a notified body" | `src/lib/legal/notices.ts` | Built |
| §8–10, §13–14, §18–19 Clauses | Proposed in Terms 0.2: customer responsibility, model variance, data minimisation, BYOK, indemnities, no indemnity for regulatory fines, liability capped at three months' fees, Romanian law and the Bucharest courts. No arbitration | `data/legal/terms.ts` | Draft (counsel 38, 41) |
| §11–12 Roles, DPA, sub-processors | The DPA proposes a role per activity. Annex 2 and the Sub-processors page render from one register | `data/legal/dpa.ts`, `register.ts` | Draft |
| §15 Imprint (Law 365/2002 art. 5, Law 31/1990 art. 74) | One entity record, all `null`; the Imprint renders placeholders until it is filled | `data/legal/entity.ts`, `imprint.ts` | **Waiting on David** |
| §16 Stripe readiness | Live checkout refuses while any contract document is a draft or a company detail is missing | `livePublicationProblems` | Built |
| §17 VAT reverse charge | Not automated. Stripe Tax stays off | — | **Accountant** (42) |
| §20.1 Acceptance ledger | `contract_acceptances`: append-only for the service role too, written only by the server after the owner/admin check, readable by owner/admin/auditor, erased with the workspace. No IP column; `vat_id_verified` and `marketing_consent` are fixed false. Downloadable record; audit line `contract.accepted` | 0068, `src/lib/legal/acceptance-store.ts`, `/settings/billing/acceptance/<id>` | Built |
| §20.2 Checkout gate | `startCheckout` refuses a workspace without an acceptance of the current texts, before any Stripe object. The browser still sends only a plan key. The Stripe customer takes the accepted legal name, and the session carries `contract_acceptance_id` in its metadata | `src/lib/billing/actions.ts` | Built |
| §20.3 Billing configuration | See "Billing configuration" below | — | One action for David |
| §20.4 Terminology | Matrix below. Novera's own surfaces changed; customer policy text is never touched | — | Built |
| §20.5 Publication controls | `/legal/*` stays `noindex` with the draft banner unless the document is approved, has an approval record, matches its frozen archived text, and the company details are complete. No public page links to a draft or says "you agree to the terms" (tested) | `src/lib/legal/publication.ts`, `data/legal/archive.ts` | Built |
| §20.6 Data-flow register | One register (status, data classes, location only where verified, transfer placeholder, who configured it). Machine-readable at `/legal/subprocessors.json`, where "in use" is read from the deployment's configuration — Resend shows as not in use where its key is empty | `data/legal/register.ts` | Built |
| §20.7 Retention schedule | Every period the code enforces, each tested against its migration or constant; placeholders where counsel, the accountant or Supabase must answer. The Privacy Notice renders it | `data/legal/retention.ts` | Built |

## Terminology (§20.4)

| Unsafe or ambiguous | Novera now says | Changed in |
|---|---|---|
| "Novera conformity report" (CSV header) | "Novera agent evaluation report" | `src/lib/report/export.ts` |
| "Exploratory scan — not a conformity report" | "Exploratory scan — not a sealed evaluation report" | Builder, run page, docs |
| "the conformity suite" (code comment) | "the evaluation suite" | `src/lib/support/answer.ts` |
| Certified / compliant / approved by a regulator | Never used about an agent or report. The report language rule (`src/lib/report/language.ts`) and the legal tests refuse them | — |
| "Approved" | Only about a person's decision: an approved draft, an approved policy version, a support reply | — |

The report page has said "Agent evaluation report" since Phase 7. `CLAUDE.md` still calls the
product a "conformity report" internally. That is orientation, not customer copy, and it is not shown
to anyone.

## Billing configuration (§20.3), as found 2026-10-13

- **Fixed:** the price variables have the names the code reads, `STRIPE_PRICE_TEAM_BYOK` and
  `STRIPE_PRICE_AGENCY_PRO`, in Production and Preview.
- **Found:** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set in **Production** as well as
  Preview, and production billing was active in Stripe *test* mode. Anyone could have subscribed
  with a test card and, since D3, run on a paid plan for free. A production deployment now refuses
  a test key (`billingConfig`), whatever the environment holds. **David:** delete both, and the two
  price variables, from Production. Keep them in Preview only, and point the sandbox webhook at a
  Preview deployment with a protection bypass.

## Launch gates (§23)

Controlled B2B pilot and paid launch both still need, from David:

- the entity details;
- counsel's review;
- verified email;
- uptime monitoring;
- backup posture.

The paid launch also needs the accountant's VAT answer. Everything in the code that these gates
depend on now exists and refuses to proceed without them.
