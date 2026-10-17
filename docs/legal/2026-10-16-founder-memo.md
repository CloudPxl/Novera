# Founder's legal, fiscal and regulatory memo (2026-10-16)

**What this is.** A memorandum David supplied on 2026-10-16 ("for legal info I will give you all of
the info I've got"). It reads as AI-assisted research. It is **not** counsel's or an accountant's
advice: its own last section says formal sign-off by retained Romanian/EU counsel and a certified
accountant is still required, and the SRL it assumes is not yet incorporated.

**How it is used.** Its positions are the *current draft positions* in the draft legal texts
(`data/legal/`) and in `docs/LEGAL-FRAMEWORK.md`. Each counsel question it addresses carries a line
"Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation" in
`docs/LEGAL-COUNSEL-QUESTIONS.md`. Nothing here is settled, and no legal text is published because
of it. Every text stays a draft, `noindex`, unlinked and not in force.

**Points in the memo to check before relying on it** are listed in
`docs/LEGAL-COUNSEL-QUESTIONS.md` ("Points in the founder's memo to check"). They include citations
that look misdirected, positions that conflict with each other, and one recommendation that conflicts
with the code.

The memo follows verbatim, as pasted.

```text
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
```
