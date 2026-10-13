/**
 * Terms of Service — DRAFT for legal review.
 *
 * Sources consulted: Romanian Law 365/2002 Articles 5–6 (information a provider of online
 * services must give); OUG 34/2014 Articles 2, 9 and 16 (consumer withdrawal, relevant only if
 * consumers are served); Civil Code Articles 1202–1203 (standard terms; "unusual" clauses take
 * effect only if expressly accepted in writing — read 2026-10-13); Regulation (EU) 2023/2854
 * (Data Act) Chapter VI, identified for counsel; Regulation (EU) 2024/3228 (ODR platform
 * discontinued, so no ODR link is drafted); Regulation (EU) 2024/1689 (AI Act) definitions.
 *
 * Version 0.2 (2026-10-13) adds the clauses drafted in the legal build brief of that date —
 * business-only service, renewal and cancellation, customer responsibility for the tested
 * system, model variance, data minimisation, BYOK, indemnities, limitation of liability,
 * governing law — each still subject to counsel. The sections listed in UNUSUAL_CLAUSES
 * (src/lib/legal/contract.ts) are the ones a customer accepts separately and expressly at
 * checkout; their headings here must not change without a new version.
 */
import type { LegalDocument } from "./types.ts";

export const terms: LegalDocument = {
  slug: "terms",
  title: "Terms of Service",
  summary: "The agreement for using Novera: business customers only, what each side is responsible for, renewal, liability and what a report does not promise.",
  status: "draft",
  version: "0.2 draft",
  lastReviewed: "2026-10-13",
  sources: ["ro-365-2002", "ro-civil-code-1203", "ro-oug-34-2014", "data-act", "odr-repeal", "ai-act"],
  body: `These terms are a draft. Every bracketed item is a fact or decision still missing, and the whole text requires review by counsel before it is offered to anyone. **DRAFT — COUNSEL REVIEW REQUIRED.**

**Effective date:** [EFFECTIVE DATE]. **Version:** 0.2 draft.

## 1. Who these terms are with

These terms are an agreement between [LEGAL ENTITY NAME], [REGISTERED ADDRESS] ("Novera", "we") and the organisation that creates an account or subscribes ("the Customer", "you"). The Imprint lists the full company details.

## 2. Business customers only

The Services are offered exclusively to Customers acting in the course of their trade, business, craft or profession. The Customer represents and warrants that it is not acquiring or using the Services as a consumer and that each person accepting these terms has authority to bind the Customer.

The Customer shall provide accurate business-identification and billing information requested by Novera, including its legal name, registered address, country of establishment and, where applicable, VAT identification number. A VAT number given at checkout is recorded as declared; Novera does not state that it has been validated unless a validation has actually been performed.

Novera may refuse, suspend or terminate registration, access, checkout or renewal where it reasonably determines that the proposed use is consumer use, that the Customer cannot provide requested business information, or that the Customer's use would create consumer-law, tax, payment-network, sanctions or compliance risk for Novera.

Nothing in these terms excludes mandatory rights that cannot lawfully be excluded where a Customer is legally determined to be a consumer. [COUNSEL TO CONFIRM WHAT VERIFICATION OF BUSINESS STATUS IS ADEQUATE.]

## 3. What Novera is

Novera runs a versioned scenario suite against an AI support agent the Customer nominates, grades each answer against a policy the Customer provides, using deterministic checks, an optional read-back of the Customer's own system, and language models, and produces a dated report sealed with a SHA-256 hash. It does not modify the agent and does not sit between the agent and the Customer's own customers.

## 4. Accounts and workspaces

- Each person keeps their own sign-in details secret and is responsible for activity under their account.
- A workspace's owner decides who is a member and with which role. The owner is responsible for removing access that should end.
- The Customer keeps the information in its account accurate.

## 5. Authorisation to test

The Customer may connect and test only agents it owns or is authorised to test. Before a run, a member declares that authorisation, and Novera stores that declaration with the run. The Customer is responsible for that declaration being true, and for any permission it needs from the agent's operator, hosting provider or model provider.

## 6. Customer data, test data and data minimisation

The Customer shall provide only data that is necessary for the intended testing purpose. The Customer shall use synthetic, anonymised, pseudonymised or redacted test data where reasonably possible and shall not submit special category data, credentials, payment-card data, government identifiers, authentication tokens, secrets, production customer data or other sensitive information unless the Customer has determined that doing so is necessary, lawful, contractually permitted, and covered by the applicable order, the Data Processing Agreement and the security controls.

The Customer remains responsible for determining whether data submitted to the Services contains personal data and for providing all notices, obtaining all permissions, establishing all legal bases, and meeting all restrictions applicable to that data and to its use of the Services.

Novera applies technical redaction, size limits, secret detection, access controls, retention rules and refusal mechanisms. These reduce risk; they do not make submitted data lawful, complete or free from personal data. An agent marked as production is never sent scenarios marked destructive or fixture-only. The Acceptable Use Policy lists what may not be done with Novera and forms part of these terms.

## 7. Customer responsibility for the tested AI system

The Customer is solely responsible for the AI system, agent, model, application, workflow, integrations, tools, prompts, policies, knowledge sources, data, deployment environment, user communications, monitoring, human oversight, incident response, documentation, risk management, classification, legal analysis and regulatory obligations of the tested system.

The Customer is solely responsible for determining whether it is a provider, deployer, importer, distributor, authorised representative, controller, processor, or otherwise subject to obligations under Regulation (EU) 2024/1689, the GDPR, sector-specific law, consumer law, employment law, financial-services law, product-safety law or any other applicable law. Novera testing an agent does not make Novera the provider or deployer of that agent.

The Customer shall not represent any Novera output as an official certification, a notified-body assessment, a CE-marking assessment, legal advice, a regulatory approval, or an assurance that the system meets any law, is safe, or carries no enforcement risk.

## 8. Evidence, not certification

A Novera report records the results of Novera's testing of the declared target, declared scenarios, declared policy or source material, run configuration, observed responses, available evidence and grading configuration at the time shown in the report.

A report is not a legal opinion, regulatory determination, statutory conformity assessment, CE-marking assessment, certification, accreditation, approval by a notified body, assurance that any law is met (including Regulation (EU) 2024/1689), or a promise of future behaviour, safety, accuracy, robustness, security or regulatory outcome. Novera is not a notified body, conformity assessment body, legal adviser, insurer or public authority. A report may identify evidence relevant to the Customer's internal governance or an external assessment; it does not replace the Customer's own legal, technical, risk, cybersecurity, data-protection, quality-management or regulatory review. The AI Testing Scope and Limitations notice forms part of these terms.

## 9. Model variance and third-party AI services

The Services use statistical and machine-learning models, including third-party model providers, to generate scenario drafts, analyses, summaries, grading opinions, settlements and other outputs. Such systems may produce variable, incomplete, inconsistent, delayed, unavailable, erroneous or non-deterministic results. Results may be affected by model version changes, provider-side changes, API changes or deprecations, provider outages, rate limits, latency, prompt or context changes, decoding configuration, safety filters, tool availability, network conditions, unavailable evidence, incomplete responses and read-back availability.

Novera does not warrant that model-generated or model-graded output is correct, complete, consistent, reproducible, unbiased, fit for a particular purpose, sufficient for any legal purpose, or free from hallucination, drift, error or variance. Where Novera presents consensus, settlement, evidence completeness or similar information, it describes the recorded testing process and the evidence available for that run; it does not turn probabilistic output into a certification, a factual guarantee or an assurance of future behaviour.

## 10. Subscription term, renewal and cancellation

[DECISION REQUIRED: PLANS AND PRICES ARE APPROVED INTERNALLY (TEAM BYOK EUR 99 AND AGENCY PRO EUR 299 A MONTH) BUT ARE NOT PUBLISHED OR SOLD LIVE; VAT DISPLAY — INCLUDING OR EXCLUDING VAT — AWAITS THE ACCOUNTANT.] The trial allows three runs per account owner. After the trial, running evaluations requires a paid plan or a written arrangement with Novera.

A subscription begins when Stripe confirms the first payment and continues for the selected billing period (monthly). **Unless the subscription is cancelled before the end of the then-current billing period, it renews automatically for successive periods of the same duration.**

Fees are charged in advance through Stripe and are non-refundable except where mandatory law requires otherwise or Novera agrees otherwise in writing. The Customer may cancel through the billing portal; cancellation takes effect at the end of the current paid period, and the Customer keeps the paid plan until then, subject to these terms. No pro-rata refund, credit or reduction is due for unused time, runs, capacity or model allowance, or for a mid-period cancellation, except where mandatory law requires otherwise or Novera agrees otherwise in writing.

Novera may change fees for a renewal period by giving prior notice through the Services, the Customer's billing contact, or both; a new fee applies only from the first renewal after [NOTICE PERIOD]. A fair-use limit applies on every plan (at present at most three runs in progress per workspace and 1,000 runs in any 30 days); support can raise it.

## 11. Availability and support

[SERVICE LEVEL — DECISION REQUIRED. THE CURRENT DRAFT OFFERS NO SERVICE LEVEL AGREEMENT.] Novera is provided on the infrastructure described on the Sub-processors page and may be unavailable for maintenance or because of a provider. Support is available through the support form at [SUPPORT CONTACT]. [SUPPORT HOURS AND RESPONSE TARGETS, IF ANY.]

## 12. Suspension and termination

Novera may suspend access to new runs, or terminate these terms, where the Customer materially breaches them or the Acceptable Use Policy, does not pay fees when due after the grace period shown on the billing page, provides false business information, or uses the Services in a way that creates legal, security or payment-network risk for Novera or others. [COUNSEL TO DRAFT: NOTICE BEFORE SUSPENSION OR TERMINATION, CURE PERIODS, AND HOW THE CUSTOMER ENDS THE AGREEMENT.] A suspension never deletes evidence: runs, reports and exports stay readable until the workspace is erased.

## 13. Intellectual property and feedback

The Customer keeps its rights in its policies, scenarios, sources, agent replies and other content. It grants Novera the rights needed to host and process that content to provide the Services. Novera keeps its rights in the software, the built-in suites and the documentation. [FEEDBACK LICENCE TERMS — COUNSEL TO DRAFT.]

## 14. Limitation of liability

To the maximum extent permitted by applicable law, Novera's aggregate liability arising out of or relating to these terms, the Services, any report, any testing result or any subscription, whether in contract, tort, negligence, misrepresentation, restitution, statutory claim or otherwise, shall not exceed the total fees actually paid by the Customer to Novera for the affected Services during the three (3) months immediately preceding the event giving rise to the claim. [COUNSEL TO CONFIRM THE CAP AND WHETHER A FLOOR IS NEEDED.]

To the maximum extent permitted by applicable law, Novera is not liable for indirect, incidental, special, exemplary, punitive or consequential damages; loss of profit, revenue, business, goodwill, data, opportunity or anticipated savings; business interruption; cost of substitute services; regulatory fines; administrative penalties; legal fees; audit costs; remediation costs; third-party claims; reputational harm; or loss arising from reliance on a report as legal, regulatory or certification evidence.

Nothing in these terms excludes or limits liability to the extent that the law does not allow it, including liability for intentional misconduct, gross negligence where the law does not allow it to be excluded, fraud, or death or personal injury.

## 15. Indemnities

To the maximum extent permitted by applicable law, the Customer shall defend, indemnify and hold harmless Novera and its personnel and sub-processors against third-party claims, regulatory investigations, administrative proceedings, penalties, fines, losses, liabilities, damages, costs and reasonable legal fees arising out of: (a) the Customer's tested AI system or any output, act, omission, tool use, communication, decision or transaction made by or through it; (b) the Customer's alleged or actual breach of applicable law; (c) the Customer's use, sharing, marketing or reliance on a Novera report beyond the limitations in these terms or the report; (d) the Customer's failure to obtain the authority, permissions, legal bases, notices, consents or contractual rights needed to provide data, connect a target system, test an agent or use third-party AI services; or (e) the Customer's breach of these terms. This indemnity does not apply to the extent a final judgment determines that the claim arose directly from Novera's intentional misconduct or from liability that cannot lawfully be excluded or transferred.

The Customer shall not seek indemnity, contribution, reimbursement, set-off or damages from Novera for administrative fines, regulatory sanctions, enforcement measures, remediation costs, business interruption, loss of revenue, reputational harm, third-party claims or compliance costs arising from the Customer's AI system, its deployment, its data, its decisions or its representations about it, except to the extent directly caused by Novera's liability that cannot lawfully be excluded. An allocation of risk between the parties does not prevent a regulator from acting against either of them.

## 16. Model providers and your own key

Where the Customer configures or supplies credentials for a third-party AI, model, cloud or other provider ("bring your own key"), the Customer instructs Novera to use that provider solely in accordance with the Customer's configuration and the documented functionality. A workspace with its own key is served on that key alone for grading, diagnosis, drafting, Suite Builder extraction and Ask Novera, with no fallback to Novera's providers.

The Customer warrants that it has obtained and will maintain all rights, permissions, legal bases, notices, consents, data-processing agreements, transfer mechanisms and provider approvals needed to send its data and testing material to the provider it selects. The Customer is solely responsible for that provider's terms, data-use and retention settings, region, security, availability, model behaviour, usage limits and fees. Novera does not provide that third-party service and does not warrant its availability, output or treatment of the Customer's data. The Customer shall indemnify Novera against claims arising from the credentials or providers it supplies, except to the extent directly caused by Novera's breach of these terms or liability that cannot lawfully be excluded.

## 17. Governing law and jurisdiction

These terms, and any non-contractual obligation arising out of or in connection with them, are governed by the laws of Romania, excluding its conflict-of-laws rules, to the extent permitted by applicable law. The competent courts of Bucharest, Romania have exclusive jurisdiction over any dispute arising out of or in connection with these terms, the Services, reports or billing, subject to any mandatory jurisdiction rules that cannot lawfully be excluded. This clause is intended for business-to-business contracts only and does not exclude rules that apply mandatorily to a legally qualifying consumer. [COUNSEL TO CONFIRM GOVERNING LAW AND FORUM. NO ARBITRATION CLAUSE IS PROPOSED FOR THE FIRST VERSION.]

## 18. Your data when the agreement ends

- A workspace owner can erase a workspace at any time. Erasure removes its agents, policies, runs, verdicts, reports and other records at once, and leaves only a record that an erasure happened, without personal data. It cannot be undone. Erasure is refused while Stripe could still charge for the workspace; cancel first.
- Reports can be exported while the workspace exists. An owner or admin can also download a complete workspace export (Settings → General). [COUNSEL TO CONFIRM WHAT DATA-EXPORT AND SWITCHING OBLIGATIONS APPLY, INCLUDING UNDER THE DATA ACT, AND THE PERIOD BEFORE DELETION AFTER TERMINATION.]
- Stripe keeps invoices and payment records under its own obligations; erasing a workspace in Novera does not delete them. [ACCOUNTANT TO CONFIRM WHICH BILLING RECORDS NOVERA MUST KEEP, AND FOR HOW LONG.]

## 19. How these terms are accepted, and changes

Before a paid plan starts, a person with authority to bind the Customer accepts these terms, the Privacy Notice, the Data Processing Agreement and the Acceptable Use Policy, confirms that the Customer acts for business purposes, and expressly accepts, separately, the clauses in Sections 2, 8, 10, 12, 14, 15 and 17. Novera records who accepted, for which organisation, when, and the version and SHA-256 fingerprint of each text accepted, and the Customer can download that record from the billing page.

Each version of these terms carries a version number and an effective date, and earlier versions remain available. Material changes will be announced by [NOTICE METHOD] at least [NOTICE PERIOD] before they take effect. [COUNSEL TO CONFIRM HOW ACCEPTANCE OF A NEW VERSION IS RECORDED.]

## 20. Contact

[LEGAL ENTITY NAME], [REGISTERED ADDRESS], [CONTACT EMAIL].`,
};
