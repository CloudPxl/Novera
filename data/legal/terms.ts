/**
 * Terms of Service — DRAFT for legal review.
 *
 * Sources consulted (read 2026-10-09): Romanian Law 365/2002 Articles 5–6 (information a
 * provider of online services must give); OUG 34/2014 Articles 2, 9 and 16 (consumer
 * withdrawal, relevant only if consumers are served); Regulation (EU) 2023/2854 (Data
 * Act) Chapter VI, identified for counsel; Regulation (EU) 2024/3228 (ODR platform
 * discontinued, so no ODR link is drafted).
 *
 * Product behaviour described here was read from CLAUDE.md's guarantees table and the
 * code it names. Liability, warranty, governing law and fees are placeholders only.
 */
import type { LegalDocument } from "./types.ts";

export const terms: LegalDocument = {
  slug: "terms",
  title: "Terms of Service",
  summary: "The agreement for using Novera: what it is, what each side is responsible for, and what it does not promise.",
  status: "draft",
  version: "0.1 draft",
  lastReviewed: "2026-10-09",
  sources: ["ro-365-2002", "ro-oug-34-2014", "data-act", "odr-repeal", "ai-act"],
  body: `These terms are a draft. Every bracketed item is a fact or decision still missing, and the whole text requires review by counsel before it is offered to anyone.

**Effective date:** [EFFECTIVE DATE]. **Version:** 0.1 draft.

## Who these terms are with

These terms are an agreement between [LEGAL ENTITY NAME], [REGISTERED ADDRESS] ("Novera", "we") and the organisation or person that creates an account ("the customer", "you").

**Who may use Novera.** [DECISION REQUIRED: WHETHER NOVERA IS OFFERED ONLY TO BUSINESSES. IF CONSUMERS MAY SIGN UP, CONSUMER-PROTECTION RULES ON INFORMATION, WITHDRAWAL AND UNFAIR TERMS APPLY AND THESE TERMS MUST BE REWRITTEN FOR THEM.] The draft below assumes business customers acting for purposes related to their trade, business or profession.

## What Novera is

Novera runs a versioned scenario suite against an AI support agent the customer nominates, grades each answer against a policy the customer provides, using deterministic checks, an optional read-back of the customer's own system, and language models, and produces a dated report sealed with a SHA-256 hash. It does not modify the agent and does not sit between the agent and the customer's own customers.

## Accounts and workspaces

- Each person keeps their own sign-in details secret and is responsible for activity under their account.
- A workspace's owner decides who is a member and with which role. The owner is responsible for removing access that should end.
- The customer keeps the information in its account accurate.

## Authorisation to test

The customer may connect and test only agents it owns or is authorised to test. Before a run, a member declares that authorisation, and Novera stores that declaration with the run. The customer is responsible for that declaration being true, and for any permission it needs from the agent's operator, hosting provider or model provider.

## Test data and prohibited use

- Scenarios should use test data. The customer should not put real customers' personal data into scenarios, policies or sources unless it has a lawful basis to do so.
- An agent marked as production is never sent scenarios marked destructive or fixture-only.
- The Acceptable Use Policy lists what may not be done with Novera, and forms part of these terms.

## The customer's responsibilities

The customer is responsible for:

- the policies it uploads and the suites and scenarios it approves;
- the agents, endpoints and read-back credentials it configures, and the permissions behind them;
- any model API key it connects, and its agreement with that provider;
- deciding which laws apply to it and to its AI agent, and meeting them;
- how it uses, shares and relies on reports.

## Evidence, not certification

A Novera report is evidence that a defined suite was run against a defined agent configuration on a defined date, with the results recorded as they occurred. It is not a legal certification, a statement of compliance with any law, or legal advice. It does not cover interactions that were not tested and does not predict future behaviour. Model grading can be wrong; each report states how its verdicts were reached and what could not be determined. The AI Testing Scope and Limitations notice forms part of these terms.

## Model providers and your own key

Grading and other features rely on third-party language model providers whose availability, behaviour and terms Novera does not control. On a workspace's own key, the customer chooses the provider and is responsible for its terms, cost and data handling; if the key cannot reach two vendors, verdicts are reported as not corroborated or corroborated within one vendor. Novera is not responsible for a provider's outage, rate limit, change of model or change of terms. [COUNSEL TO REVIEW THIS LIMITATION.]

## Availability and support

[SERVICE LEVEL — DECISION REQUIRED. THE CURRENT DRAFT OFFERS NO SERVICE LEVEL AGREEMENT.] Novera is provided on the infrastructure described on the Sub-processors page and may be unavailable for maintenance or because of a provider. Support is available through the support form at [SUPPORT CONTACT]. [SUPPORT HOURS AND RESPONSE TARGETS, IF ANY.]

## Intellectual property and feedback

The customer keeps its rights in its policies, scenarios, sources, agent replies and other content. It grants Novera the rights needed to host and process that content to provide the service. Novera keeps its rights in the software, the built-in suites and the documentation. [FEEDBACK LICENCE TERMS — COUNSEL TO DRAFT.]

## Fees and billing

[DECISION REQUIRED: PLANS, PRICES, CURRENCY, VAT TREATMENT, BILLING PERIOD, PAYMENT METHOD AND PAYMENT PROVIDER.] No price is published. A trial allows three runs per account owner, graded on Novera's own keys. Paid plans are planned through a payment provider and will be described here, with their prices and tax, before any charge is made.

## Suspension and termination

[COUNSEL TO DRAFT: GROUNDS AND NOTICE FOR SUSPENSION, FOR EXAMPLE A BREACH OF THE ACCEPTABLE USE POLICY OR NON-PAYMENT; HOW EITHER SIDE ENDS THE AGREEMENT; NOTICE PERIODS.]

## Your data when the agreement ends

- A workspace owner can erase a workspace at any time. Erasure removes its agents, policies, runs, verdicts, reports and other records at once, and leaves only a record that an erasure happened, without personal data. It cannot be undone.
- Reports can be exported while the workspace exists. A complete workspace export is planned and not yet available. [COUNSEL TO CONFIRM WHAT DATA-EXPORT AND SWITCHING OBLIGATIONS APPLY, INCLUDING UNDER THE DATA ACT, AND THE PERIOD BEFORE DELETION AFTER TERMINATION.]

## Warranties and liability

[COUNSEL TO DRAFT: WARRANTY DISCLAIMERS, LIMITATION AND CAP OF LIABILITY, EXCLUSIONS THAT THE LAW DOES NOT ALLOW, INDEMNITIES. THESE MUST BE CHECKED AGAINST THE GOVERNING LAW CHOSEN.]

## Governing law and disputes

[GOVERNING LAW — DECISION REQUIRED.] [COURTS OR OTHER FORUM FOR DISPUTES — DECISION REQUIRED.] [IF CONSUMERS ARE SERVED: THE CONSUMER-COMPLAINT AND ALTERNATIVE DISPUTE RESOLUTION INFORMATION REQUIRED IN ROMANIA, AND ANY OTHER COUNTRY TARGETED.]

## Changes to these terms

Each version of these terms carries a version number and an effective date, and earlier versions remain available on request. Material changes will be announced by [NOTICE METHOD] at least [NOTICE PERIOD] before they take effect. [COUNSEL TO CONFIRM HOW ACCEPTANCE OF A NEW VERSION IS RECORDED.]

## Contact

[LEGAL ENTITY NAME], [REGISTERED ADDRESS], [CONTACT EMAIL]. The Imprint lists the full company details.`,
};
