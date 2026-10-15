# Questions for counsel

For a lawyer covering Romanian and EU SaaS, data protection, consumer, tax and AI law, and an
accountant where marked. Each question names the draft it unblocks (`/legal/<slug>`, source in
`data/legal/`). The facts quoted about the product are from the code at HEAD `1b7d026`
(2026-10-09). Nothing below is a conclusion: where a draft proposes an answer, it is marked as a
proposal.

## The facts counsel needs first

- Founder: David Rosu, Romanian. No company exists yet. Database: Supabase, project region
  `eu-central-1` (Frankfurt). Server functions: Vercel, pinned to `fra1` (Frankfurt); the CDN may
  serve from anywhere. Email: Resend (configured, not yet sending in production).
- Model providers on Novera's keys: Groq (US-operated) and Mistral AI (France) receive customer
  content, including agent replies that may contain personal data. OpenRouter and Google's free tier
  are technically limited to material Novera wrote. On a customer's own key: Groq, Google AI Studio,
  OpenRouter or Anthropic, chosen by the customer.
- Customers: agencies and teams that build AI support agents, mostly in or selling into the EU. The
  product sends test scenarios to the customer's agent, stores the replies (30 to 365 days, default
  180), grades them with models, and seals a hashed report.

## Entity, tax and accounting

1. Which legal form fits a one-person SaaS selling B2B across the EU (SRL, SRL with micro-enterprise
   tax regime, PFA, or another), and what does each mean for liability and for the imprint? *(Imprint,
   Terms)* — with the accountant.
2. VAT: registration threshold, intra-EU B2B reverse charge, and whether to use OSS if consumers are
   ever served. What must invoices and the Terms state? *(Terms, Refunds)* — accountant.
3. How long must billing and accounting records be kept in Romania, and does that override a
   customer's erasure request for billing data? *(Privacy)* — accountant.
4. Which fields does Legea 365/2002 Art. 5 require for the chosen form, which "competent authority"
   (Art. 5(1)(f)) applies, if any, and does targeting Germany or Austria add imprint duties?
   *(Imprint)*

## B2B or consumers

5. Can Novera lawfully restrict sign-up to businesses, and what must the sign-up flow do to make
   that restriction effective (a declaration, a company field, VAT ID check)? *(Terms)*
6. If a consumer signs up anyway: which parts of OUG 34/2014 apply (pre-contract information, 14-day
   withdrawal, the Art. 16 exception for services fully performed, any online withdrawal function),
   and what ANPC complaint and SAL information must be shown? The EU ODR platform ended in 2025
   (Reg. 2024/3228), so no ODR link is drafted — confirm. *(Terms, Refunds)*

## Roles under the GDPR

7. Confirm the proposed allocation: Novera as controller for accounts, profiles, support messages,
   Ask Novera and abuse prevention; as processor for test evidence, policies, reports, Suite Builder
   sources and production failures. *(Privacy, DPA)*
8. Which role does Novera have for the workspace audit trail and the run attestation (who declared
   authority to test an agent), which serve both the customer's governance and Novera's security?
9. When an agency tests its client's agent, is the agency a processor and Novera a sub-processor? How
   should the DPA be structured so it works in both cases? *(DPA)*
10. Does a customer's own model provider (bring-your-own-key) count as Novera's sub-processor, or as
    the customer's own processor? Same question for the customer's agent endpoint, read-back endpoint
    and webhook receivers. *(Sub-processors, DPA)*

## Legal bases, retention, rights

11. Confirm or replace each proposed legal basis in the Privacy Notice's purposes table, and whether
    a legitimate-interests assessment must be written for abuse prevention (salted hashes of IP
    addresses, rate counters) and the audit trail. *(Privacy)*
12. Assistant memory is off by default and holds only what a person saves: contract or consent?
13. Verdicts, reports and the audit trail are kept until the workspace is erased, with no fixed end,
    because evidence that could be selectively deleted is not evidence. Is that compatible with
    storage limitation, and what should the notice say? Same for invitation addresses of people who
    never accepted. *(Privacy, DPA)*
14. Account deletion pseudonymises the person's identifier in other workspaces' evidence rather than
    deleting it. Is that an adequate response to an erasure request? *(Privacy)*
15. Is a DPO required (Art. 37), given that agent replies may contain any category of personal data?
    *(Privacy)*
16. Does Novera's own processing need a DPIA (WP248 rev.01 criteria: evaluation, innovative
    technology, large scale), or should the DPA only promise assistance with the customer's? *(DPA)*
17. Which supervisory authority is lead, and is ANSPDCP correct while the founder and entity are in
    Romania? *(Privacy)*
18. Confirm no processing is an Art. 22 decision: verdicts concern an AI agent's behaviour, support
    replies are approved by a person, and Ask Novera cannot act. *(Privacy)*

## International transfers

19. Which transfer mechanism applies to each provider (adequacy, including the EU-US Data Privacy
    Framework where the provider is certified; standard contractual clauses; or none needed), and is
    a transfer impact assessment needed for Groq? *(Privacy, DPA, Sub-processors)*
20. Novera's model-provider router enforces data-class ceilings set from each provider's published
    terms. Is that a measure worth stating in Annex 1, and what wording avoids overstating it?
    *(DPA)*

## Cookies

21. Do the Supabase session cookie (400-day library default), `nv_ws` (one year), `nv_invite`
    (seven days), `nv_recovery` (fifteen minutes) and the `novera.motion` local-storage preference
    all fall within Legea 506/2004 Art. 4(6)(b) / ePrivacy Art. 5(3) strict necessity, so that no
    banner is needed? Should the session lifetime be shortened? *(Cookies)*
22. First-party product events are recorded in production (stored server-side, nothing in the
    browser, the person only as a keyed hash, 13 months, including each view of a report). Is consent
    needed? *(Cookies, Privacy)*

## AI Act

23. Is Novera a provider or deployer of an AI system within Art. 3, for (a) Ask Novera, (b)
    model-drafted support replies a person approves, (c) model grading? *(AI Testing Scope)*
24. Does Art. 50(1) (informing people they interact with an AI system) apply to Ask Novera, and are
    the current disclosures adequate in wording and placement (the panel says questions go to model
    providers)? Art. 50 has applied since 2 August 2026. *(AI Testing Scope)*
25. Does Art. 50(2) marking apply to text Novera's features generate, and does the Digital Omnibus
    (Reg. 2026/1744) transition to 2 December 2026 matter here? *(AI Testing Scope)*
26. Art. 4 now requires measures to support AI literacy (as amended by Reg. 2026/1744). What is
    proportionate for a one-person company? *(none drafted)*
27. Could the product's marketing, or reports organised by "obligation codes", be read as offering a
    conformity assessment or legal advice? What wording keeps a report clearly "evidence of testing,
    not certification"? *(AI Testing Scope, Terms)*

## Contract terms

28. Liability: cap, exclusions, and what Romanian law (or the chosen governing law) does not allow to
    be excluded. Particular risks: a false pass in a report a customer relied on; a scenario sent to
    an agent the customer was not authorised to test. *(Terms)*
29. Authorisation to test: is the stored attestation enough to shift responsibility to the customer,
    and does unauthorised testing of a third party's AI agent raise criminal-law exposure (for
    example under Romanian rules on illegal access to computer systems) for Novera? *(Terms, AUP)*
30. Governing law and forum for EU B2B customers. *(Terms)*
31. Data Act Chapter VI (switching between data processing services, in force since 12 September
    2025): does a SaaS like Novera fall under it, and what must the Terms say about export, switching
    and the deletion period? Novera has report exports and a full workspace export (owner or admin). *(Terms,
    DPA)*
32. How must acceptance of a new version of the Terms be recorded? The product records none today.
    *(Terms)*
33. Sub-processor change notice: what period and channel, and what happens if a customer objects?
    *(DPA, Sub-processors)*

35. A run's attestation names the attesting member's email address and is sealed into every report
    for that agent, which the report's recipients see and which account deletion cannot remove. Is
    that justified (Art. 6, Art. 17), or should future attestations name a role or an id? *(Privacy)*

## Added 2026-10-13 (legal build brief; the drafts now carry its proposed clauses)

The Terms (version 0.2 draft) now propose the brief's clauses: business customers only (§2), customer
responsibility for the tested system (§7), the report's limits (§8), model variance (§9), monthly
auto-renewal with no refunds for unused time (§10), suspension (§12), liability capped at three
months' fees with exclusions of indirect and regulatory losses (§14), customer indemnities including
for regulatory fines (§15), BYOK warranties (§16), Romanian law and the Bucharest courts (§17). Every
one of them is a proposal for counsel, not a decision.

36. **Article 1203 acceptance.** Before a paid plan, an owner or admin ticks three separate boxes
    (none pre-ticked): the documents; an express, separate acceptance of Terms sections 2, 8, 10, 12,
    14, 15 and 17, each listed with what it covers; and business purpose with authority to bind. Novera
    stores who, when, the organisation's details and the SHA-256 of each text and of those sections
    (0068), and offers a downloadable record. Does an online checkbox of this kind satisfy "expressly
    accepted in writing" (Civil Code art. 1203), or is a qualified electronic signature or a signed
    order form needed for some clauses? *(Terms)*
37. **B2B verification.** The gate asks for the legal name, registered address, country, an optional
    VAT number (recorded as declared; Novera does not validate it) and the declarations. What
    verification is adequate for a B2B-only service, and what follows if a consumer gets through?
    *(Terms §2)*
38. **Liability cap.** Is three months' fees defensible under Romanian law, with or without a fixed
    floor, and which exclusions in §14 cannot be enforced? *(Terms §14)*
39. **Report terminology.** Novera's own surfaces now say "agent evaluation report" and carry a
    standing notice that a report is not a conformity assessment, certification or notified-body
    approval. Does any remaining use of "obligation" or "evidence" language still risk appearing as a
    statutory conformity assessment? *(AI testing scope, reports)*
40. **Acceptance records after erasure.** Erasing a workspace deletes its acceptance records with it,
    as it deletes everything else. Must they be kept as evidence of the contract, and for how long?
    The records name the signer and their title. *(Privacy, retention)*
41. **Roles per data flow.** The DPA now proposes a role per activity (processor for testing,
    controller for accounts, billing and acceptance). Confirm or correct. *(DPA §1)*
42. **Accountant: VAT on cross-border B2B.** Directive 2006/112/EC Art. 196 (reverse charge) and Fiscal
    Code Art. 307(2): exact invoice wording, VIES validation, what happens with an invalid VAT number,
    prices net or gross, OSS if consumers ever buy, and non-EU customers. Stripe Tax stays off until
    this is answered. *(Refunds, Terms §10)* EUR-Lex could not be read when the drafts were updated,
    so neither text is among the dated sources.

## Email and marketing

34. Novera sends only transactional email. If lifecycle or product-update emails are added, does Legea
    365/2002 Art. 6 require prior express consent for B2B recipients too? *(Privacy)*

## Where the law may differ

Answers for Romania may not hold elsewhere. Flag where German (imprint, consumer, liability), UK
(UK GDPR, transfers back to the EU) or other targeted countries' rules differ, so the drafts can say
which jurisdiction each clause assumes.

## Everything still pending (as of 2026-10-13)

Every item below is open, waiting, or not yet confirmed. The questions above are unanswered; this list
is everything else that stands between today and a pilot or a paid launch. Live status:
the staff-only `/readiness` page. Ledger: `docs/LAUNCH-READINESS.md`.

### For counsel

- Questions 1–42 above: none answered yet.
- Review and approve every draft legal text (L1): privacy, terms, DPA, sub-processors, imprint, cookies, acceptable use, security, AI testing scope, refunds. All are `noindex` with the draft banner until approved.
- A privacy notice linked wherever personal data is collected: sign-up, support, apply (L3). Needs the approved privacy notice first.
- Governing law and forum (Romanian law, Bucharest courts proposed; no arbitration).
- How and how early changes to the terms and sub-processors are announced.
- The effective date of the legal texts (after sign-off).
- Whether an attestation names a person, a role or an id (it is sealed into reports and survives account deletion).
- Consent for first-party product events (the analytics salt question).
- The public page `/solutions/eu-ai-act` names AI Act articles (counted from the suite's duty references) and is live: review its wording.
- The report wording "testing evidence, not a certification" across reports, exports, `/verify` and the print footer: confirm it is enough.

### For the accountant

- Legal form: PFA, SRL or another (with David).
- VAT: prices shown with or without VAT (D1); reverse-charge invoice wording; VIES validation; invalid VAT numbers; non-EU customers (question 42). Stripe Tax stays off until answered.
- Romanian VAT registration status and any recapitulative statements.

### For David: the legal entity and the paid launch

- Register the entity and fill `data/legal/entity.ts`: legal name, form, registered office, Trade Register number, CUI, VAT ID if any, share capital for an SRL, representative, phone (L7). Live checkout refuses until it is complete.
- Live activation (P5): Stripe account for the entity, live products and prices, live webhook and Customer Portal, then `BILLING_ALLOW_LIVE`.
- Publish prices only after the entity exists and billing is live (no prices on any public page, structured data or card until then).
- Commercial decisions still open: grace period after a failed payment (D5); Stripe's "after all retries fail" setting (D6); a free trial on a paid plan (D7); proration on upgrades and downgrades (D8); features gated by plan (D10); a funded grading budget for Agency Pro's managed runs.
- Service level, support hours and response targets.
- Hosting tier that allows a paid product: Vercel Pro before charging (O12).

### For David: configuration and operations

- Remove `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_TEAM_BYOK` and `STRIPE_PRICE_AGENCY_PRO` from Vercel Production; keep them in Preview (L8). Production currently refuses the test key, so billing there is off.
- Point the Stripe sandbox webhook at a Preview deployment with a protection bypass, then run the sandbox end to end with a throwaway workspace.
- Production email (A1): Resend domain verified, Supabase custom SMTP, then a live test of confirmation, reset, invitation and support reply.
- Mailboxes for `support@` and `dmarc@nover.space`: there is no MX record, so mail to them bounces (O13).
- Google and GitHub identity linking: the setting is reported on but not independently proven in production (D).
- Production backups and a restore point; RTO and RPO (O11).
- An uptime check on `/api/health` and an error destination, such as a Sentry EU DSN (O10).
- A third, independent grading vendor: a funded key, then calibration before it grades (O8).
- `npm run seed:docs` against production, so the three integration guides answer (they are in the sitemap and `llms.txt` already).
- Manual grants for the two production workspaces past their trial, or not (`docs/BILLING-DECISIONS.md` §1).
- Search Console and Bing Webmaster verification (a DNS TXT record).
- GitHub `main` branch protection: confirm the ruleset is active and enforced.
- Delete the 2026-10-08 audit account (only on David's explicit word).
- Publish the CLI package (`novera-cli`), or keep it private.

### Not yet confirmed in code or production

- The production deploys of `4a1d6e6` and `e355347` were not checked after pushing.
- `/readiness` reads three repo documents at request time; the build traces them, but reading them on Vercel is unproven until the first visit there.
- Print and PDF were checked as print-media screenshots only; no PDF was rendered to images. The run page's "Not sealed" print line has not been seen in a browser.
- Scheduled jobs in production (`verify:cron`) were last checked on 2026-10-11.
- `reports.content_hash` has no index; `/verify` scans the table (fine at today's size; a migration when it grows).
- An agency workspace with one client workspace: the dashboard's main button says "Add a client workspace" while the setup rail says "Connect your agent".
- Web manifest and Apple touch icon (SEO track) not added.
- The new `/support` and `/apply` page descriptions were written by Claude and are not yet reviewed by David.



NOVERA V2: LEGAL, FISCAL & REGULATORY COUNSEL MEMORANDUM
PART I: Entity, Tax, and Accounting (Questions 1–4)
Legal Form for a B2B SaaS (SRL vs. PFA):

Recommendation: SRL (Societate cu Răspundere Limitată) is the only viable structure for a B2B SaaS. A PFA (Persoană Fizică Autorizată) exposes personal assets to unlimited liability, which is fatal for software entering enterprise B2B contracts and handling third-party AI system endpoints.

Tax Regime (2026 Rules): Under current Romanian law, a newly established SRL with at least one full-time employee (the founder can be the employee-administrator) qualifies for the 1% micro-enterprise turnover tax (impozit pe veniturile microîntreprinderilor) provided annual revenue stays under €100,000. Exceeding €100,000 shifts the company to the standard 16% corporate profit tax (impozit pe profit). Dividend distribution tax is 16%.

VAT, Intra-EU B2B, and Invoicing:

Domestic Registration Threshold: Standard VAT registration is mandatory once domestic turnover exceeds RON 395,000 (~€73,930), though voluntary registration or early registration for intra-EU VIES validation is standard for B2B SaaS.

Intra-EU B2B Reverse Charge: Under Council Directive 2006/112/EC Art. 196 and Romanian Fiscal Code Art. 307(2), cross-border B2B sales to taxable persons in other EU member states use the reverse-charge mechanism (VAT is accounted for by the business recipient). Invoices must state: "Reverse charge — VAT to be accounted for by the recipient (Art. 196 Council Directive 2006/112/EC)".

OSS: Since Novera is strictly B2B-only, the One-Stop-Shop (OSS) consumer scheme does not apply unless B2C sales are intentionally unlocked.

Accounting Record Retention:

Financial, accounting, and billing records must be kept in Romania for 5 to 10 years (per Romanian Accounting Law No. 82/1991). Statutory accounting retention overrides a customer's GDPR Article 17 erasure request for invoices, transaction logs, and billing ledger rows.

Legea nr. 365/2002 Article 5 Imprint Requirements:

Mandatory disclosures in the website footer/imprint: Legal Name, Form (SRL), Registered Office, Trade Register Number (Jxx/...), Unique Registration Code (CUI / RO...), Social Capital, and contact email.

Competent Authority (Art. 5(1)(f)): For an e-commerce B2B SaaS operating in Romania, the relevant market surveillance and consumer protection authority (if applicable) is ANPC (Autoritatea Națională pentru Protecția Consumatorilor), alongside ANSPDCP for data protection. Targeting Germany or Austria adds local consumer protection disclosure norms and mandatory Impressum duties under the German TMG/DDG if local commercial presence is deemed established, though pure B2B cross-border digital services enjoy EU freedom to provide services.

PART II: B2B Boundaries & Consumer Protection (Questions 5–6)
Enforcing B2B-Only Restrictions:

A unilateral label stating "business only" is legally rebuttable if an actual consumer signs up. To make the restriction effective, Novera uses an active checkout gate requiring: (a) a legal company name, (b) a declaration that the service is acquired exclusively for trade/business purposes, and (c) an executive authority checkbox. If a user is later identified as a consumer, accounts should be terminated or isolated to prevent consumer-law exposure.

Consumer Rules (OUG nr. 34/2014) & ANPC/SAL:

If a consumer bypasses the gate, standard 14-day withdrawal rights apply unless waived via explicit digital-content execution consent under Art. 16(m).

Note: Because Novera is structured strictly as a B2B platform, consumer dispute resolution links (SAL/ODR) are omitted, relying on the B2B commercial terms.

PART III: GDPR Role Allocation & Data Flows (Questions 7–10, 19–20)
Controller vs. Processor Split:

Novera as Controller: Account profiles, authentication logs, billing records, support communications, platform abuse prevention, and internal telemetry.

Novera as Processor: Customer-uploaded test scenarios, policies, agent responses, test evidence transcripts, Suite Builder sources, and sealed evaluation reports.

Audit Trail & Attestation Roles:

The workspace audit trail and run attestation serve a dual purpose: they function as processor logs for the client's internal compliance and as controller security/abuse records for Novera.

Agency & Sub-Processor Chains:

When an agency evaluates a client's agent using Novera, the agency acts as a controller (or processor to their client), making Novera their sub-processor. The DPA must accommodate multi-tenant agency workspaces and client sub-delegations.

BYOK & Endpoint Scope:

Customer-selected model providers (BYOK), target agent endpoints, and webhook receivers do not count as Novera's sub-processors; they are external services integrated directly under the customer's instruction and configuration.

PART IV: Legal Bases, Retention, Rights & Cookies (Questions 11–18, 21–22)
Legal Bases & Legitimate Interests:

Legitimate interests (GDPR Art. 6(1)(f)) apply to salted IP hashing for rate-limiting and abuse prevention, backed by a written Legitimate Interests Assessment (LIA). Contract performance (Art. 6(1)(b)) covers core test execution and billing.

Assistant Memory:

Saved agent memory operates on explicit user action (consent/configuration).

Verdict & Report Storage Limitation:

Sealed reports and audit trails are retained for the lifetime of the workspace because an immutable cryptographic evidence ledger cannot support selective partial deletion without breaking hash verification. This is justified under archival and legal-defense exemptions.

Account Erasure & Pseudonymisation:

Deleting an account pseudonymises personal identifiers within shared workspace audit trails rather than rewriting historical immutable evidence blocks, complying with GDPR mitigation standards.

Data Protection Officer (DPO):

Not formally mandatory under Art. 37 unless large-scale systematic monitoring of special categories occurs, but a designated privacy contact is maintained.

DPIA Requirement:

Novera evaluates AI agent behavior (not natural persons), so a core consumer-profiling DPIA is not triggered. However, the DPA assists customers with their own AI Act/GDPR DPIAs.

Lead Supervisory Authority:

ANSPDCP (Romania) is the primary supervisory authority given the founder and entity domicile.

Automated Decision-Making (Art. 22):

None. Verdicts assess machine software behavior, support drafts require human approval, and Ask Novera is advisory.

International Transfers & SCCs:

Third-party model providers operating outside the EU rely on EU-US Data Privacy Framework (DPF) certifications or standard contractual clauses (SCCs). Transfer Impact Assessments (TIAs) apply where non-adequacy routes are used.

Data-Class Ceilings:

Stated in DPA Annex 1 to reflect provider-specific handling bounds.

Strictly Necessary Cookies:

Supabase session cookies, workspace tokens (nv_ws), recovery tokens, and UI motion preferences fall under ePrivacy Art. 5(3) strict necessity or user-interface persistence, exempting cookie banners.

First-Party Analytics:

Server-side keyed hashes stored for 13 months do not require invasive browser tracking consent if no cross-site tracking or PII profiling occurs.

PART V: EU AI Act Nuances (Questions 23–27)
Provider vs. Deployer Classification:

Novera is a provider of its own SaaS evaluation platform. It is neither provider nor deployer of the customer's tested conversational agent.

Article 50(1) Transparency (AI Interaction):

Applies to conversational features like Ask Novera; notices must clearly state that answers are generated by probabilistic models.

Article 50(2) Artificial Generation Markings:

Applied to machine-generated synthetic test drafts and report summaries.

Article 4 (AI Literacy):

Satisfied via public documentation, integration guides, and developer knowledge bases.

Avoiding Certification Claims:

Enforced strictly via mandatory disclaimers: reports are testing evidence of declared scenarios, not statutory conformity assessments or legal certifications.

PART VI: Contract Terms & Liability (Questions 28–35, 36–42)
Liability Cap & Exclusions:

Capped at 3 months' fees paid, with explicit exclusion of indirect, consequential, and regulatory penalty losses. Cannot lawfully exclude liability for intentional misconduct (intent / dol) or gross negligence (* culpă gravă*) under Romanian law.

Authorization to Test:

Customer warranties and signed execution attestations shift responsibility; unauthorized third-party scanning is prohibited via Acceptable Use Policies (AUP).

Governing Law & Forum:

Romanian law with exclusive jurisdiction in the competent courts of Bucharest.

Data Act Chapter VI:

Addressed via native JSON, Markdown, and full workspace export capabilities.

Terms Versioning & Acceptance Ledger:

Recorded immutably in the contract_acceptances database table with timestamp, user ID, workspace ID, and SHA-256 digests.

Sub-Processor Change Notice:

Managed via general written notice and the public subprocessor registry.

Email / Marketing Consent:

Legea 365/2002 Art. 6 requires express prior opt-in consent for unsolicited commercial communications, even in B2B contexts.

Attestation Identifiers:

Attestations bind to workspace administrative roles/IDs rather than immutable personal data where feasible.

Civil Code Article 1203 Express Acceptance:

Satisfied via the 3-checkbox layered online acceptance flow recording explicit consent to unusual clauses (liability caps, auto-renewal, jurisdiction).

B2B Verification Guardrails:

Company name, address, and VAT declarations collected at checkout; non-compliant registrations flagged or suspended.

Liability Cap Defensibility:

3 months' fees is standard and defensible in B2B SaaS, provided unexcludable statutory liabilities are preserved.

Report Terminology Audit:

All references to "conformity assessment" or "compliance certificates" purged in favor of "Evaluation Evidence Report".

Acceptance Record Retention:

Retained as legal contract formation evidence under accounting/civil limitation periods.

Data Flow Roles:

Confirmed: processor for test execution; controller for accounts, billing, and acceptance ledgers.

Cross-Border VAT & VIES:

Accountant review required for automatic VIES status verification, invoice reverse-charge annotations, and non-EU billing logic before Stripe live mode activation.

OUT-OF-REACH ITEMS FOR AI (Requires Human Execution)
Formal Legal & Tax Sign-Off: Review and wet-ink/formal sign-off of the draft legal suite (/legal/*) by retained Romanian/EU counsel and a certified accountant.

Entity Registration: Official incorporation of the Romanian SRL entity at the Trade Register (Registrul Comerțului), obtaining the CUI and fiscal registration.

Stripe Live Activation: Flipping Stripe from sandbox to live mode, attaching the corporate bank account, and validating live tax configuration with the accountant.

Resend & SMTP Production Handshake: Finalizing DNS TXT/MX records (support@, dmarc@) and proving live transactional email delivery.

Vercel Production Tier & Backups: Upgrading Vercel hosting tier for production traffic and verifying automated Supabase point-in-time recovery (PITR) schedules.