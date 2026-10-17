# Questions for counsel

For a lawyer covering Romanian and EU SaaS, data protection, consumer, tax and AI law, and an
accountant where marked. Each question names the draft it unblocks (`/legal/<slug>`, source in
`data/legal/`). The facts quoted about the product are from the code at HEAD `1b7d026`
(2026-10-09). Nothing below is a conclusion: where a draft proposes an answer, it is marked as a
proposal.

**Founder's memo, 2026-10-16.** David supplied a legal, fiscal and regulatory memorandum
(`docs/legal/2026-10-16-founder-memo.md`, verbatim). It reads as AI-assisted research, and its own
last section says retained counsel and an accountant must still sign off, and that the SRL is not
incorporated. Each question below now carries the memo's proposed answer, marked "awaiting counsel
confirmation". None is settled. The drafts adopt the memo's positions as draft positions only, and
every legal text stays a draft, `noindex`, unlinked and not in force. Where the memo looks wrong,
conflicts with itself or conflicts with the code, it is listed under "Points in the founder's memo
to check" below and was not adopted silently.

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
   **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** an SRL (a PFA's unlimited personal liability is unsuitable for B2B contracts); micro-enterprise turnover tax of 1% while annual revenue stays under EUR 100,000 and the company has at least one employee (the founder-administrator can be that employee), 16% profit tax above that, 16% dividend tax. Figures per the memo, for the accountant to confirm, including whether a software activity code changes the micro rate.
2. VAT: registration threshold, intra-EU B2B reverse charge, and whether to use OSS if consumers are
   ever served. What must invoices and the Terms state? *(Terms, Refunds)* — accountant.
   **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** VAT registration is mandatory above RON 395,000 domestic turnover (about EUR 73,930); intra-EU B2B sales are reverse-charged (Directive 2006/112/EC Art. 196) with the invoice wording "Reverse charge — VAT to be accounted for by the recipient (Art. 196 Council Directive 2006/112/EC)"; no OSS while Novera is B2B only. See the points to check below on Fiscal Code Art. 307(2) and Art. 317. Per the memo, for the accountant to confirm.
3. How long must billing and accounting records be kept in Romania, and does that override a
   customer's erasure request for billing data? *(Privacy)* — accountant.
   **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** accounting and billing records are kept 5 to 10 years (Law 82/1991), and that obligation overrides an Art. 17 erasure request for invoices, transaction logs and billing ledger rows. Today erasure deletes Novera's own billing rows and acceptances (see "Retention gap" below).
4. Which fields does Legea 365/2002 Art. 5 require for the chosen form, which "competent authority"
   (Art. 5(1)(f)) applies, if any, and does targeting Germany or Austria add imprint duties?
   *(Imprint)*
   **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** legal name, form (SRL), registered office, trade register number, CUI, share capital, contact email; ANPC (consumer protection, where applicable) and ANSPDCP (data protection) as the authorities; German or Austrian Impressum duties only with a local establishment. The imprint draft now follows this, every value pending incorporation. See the point to check on Art. 5(1)(f).

## B2B or consumers

5. Can Novera lawfully restrict sign-up to businesses, and what must the sign-up flow do to make
   that restriction effective (a declaration, a company field, VAT ID check)? *(Terms)*
   **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** a label alone is rebuttable; an active checkout gate with (a) the legal company name, (b) a declaration of acquisition exclusively for business purposes and (c) a separate authority checkbox. Built: (b) and (c) are separate checkboxes since 2026-10-16.
6. If a consumer signs up anyway: which parts of OUG 34/2014 apply (pre-contract information, 14-day
   withdrawal, the Art. 16 exception for services fully performed, any online withdrawal function),
   and what ANPC complaint and SAL information must be shown? The EU ODR platform ended in 2025
   (Reg. 2024/3228), so no ODR link is drafted — confirm. *(Terms, Refunds)*
   **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** 14-day withdrawal applies if a consumer gets through unless waived (the memo cites Art. 16(m)); consumer accounts are suspended or isolated; SAL and ODR links are omitted because Novera is B2B only. Terms 0.3 §2 says so. See the point to check on Art. 16(m).

## Roles under the GDPR

7. Confirm the proposed allocation: Novera as controller for accounts, profiles, support messages,
   Ask Novera and abuse prevention; as processor for test evidence, policies, reports, Suite Builder
   sources and production failures. *(Privacy, DPA)*
   **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** controller for accounts, authentication logs, billing, support communications, abuse prevention and telemetry; processor for scenarios, policies, agent responses, transcripts, Suite Builder sources and sealed reports. Privacy 0.3 and DPA 0.3 follow it.
8. Which role does Novera have for the workspace audit trail and the run attestation (who declared
   authority to test an agent), which serve both the customer's governance and Novera's security?
   **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** both: processor logs for the customer's governance, controller records for Novera's security and abuse prevention.
9. When an agency tests its client's agent, is the agency a processor and Novera a sub-processor? How
   should the DPA be structured so it works in both cases? *(DPA)*
   **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** the agency is controller, or processor for its client, making Novera its sub-processor; the DPA accommodates agency workspaces. DPA 0.3 §1 drafts this. See the point to check on controller versus processor.
10. Does a customer's own model provider (bring-your-own-key) count as Novera's sub-processor, or as
    the customer's own processor? Same question for the customer's agent endpoint, read-back endpoint
    and webhook receivers. *(Sub-processors, DPA)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** none of them is Novera's sub-processor; they are integrated on the customer's instruction and configuration.

## Legal bases, retention, rights

11. Confirm or replace each proposed legal basis in the Privacy Notice's purposes table, and whether
    a legitimate-interests assessment must be written for abuse prevention (salted hashes of IP
    addresses, rate counters) and the audit trail. *(Privacy)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** Art. 6(1)(f) for salted IP hashing with a written assessment (drafted: `docs/legal/lia-abuse-prevention-draft.md`); Art. 6(1)(b) for test execution and billing.
12. Assistant memory is off by default and holds only what a person saves: contract or consent?
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** by explicit user action ("consent/configuration"). The Privacy draft proposes consent and keeps the question open.
13. Verdicts, reports and the audit trail are kept until the workspace is erased, with no fixed end,
    because evidence that could be selectively deleted is not evidence. Is that compatible with
    storage limitation, and what should the notice say? Same for invitation addresses of people who
    never accepted. *(Privacy, DPA)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** kept for the workspace's lifetime, because a hash-sealed ledger cannot lose single entries and still verify. The memo also cites an "archival" exemption; see the point to check.
14. Account deletion pseudonymises the person's identifier in other workspaces' evidence rather than
    deleting it. Is that an adequate response to an erasure request? *(Privacy)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** yes: pseudonymisation of identifiers in shared audit trails rather than rewriting sealed evidence. See the points to check (pseudonymised data stays personal data; acceptance records keep the signer's name).
15. Is a DPO required (Art. 37), given that agent replies may contain any category of personal data?
    *(Privacy)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** no DPO is mandatory; a designated privacy contact instead. No mailbox exists for one yet (O13).
16. Does Novera's own processing need a DPIA (WP248 rev.01 criteria: evaluation, innovative
    technology, large scale), or should the DPA only promise assistance with the customer's? *(DPA)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** no DPIA for Novera's own processing (it evaluates agents, not people); the DPA promises help with the customer's.
17. Which supervisory authority is lead, and is ANSPDCP correct while the founder and entity are in
    Romania? *(Privacy)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** ANSPDCP.
18. Confirm no processing is an Art. 22 decision: verdicts concern an AI agent's behaviour, support
    replies are approved by a person, and Ask Novera cannot act. *(Privacy)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** none: verdicts assess software, support drafts need a person's approval, Ask Novera is advisory.

## International transfers

19. Which transfer mechanism applies to each provider (adequacy, including the EU-US Data Privacy
    Framework where the provider is certified; standard contractual clauses; or none needed), and is
    a transfer impact assessment needed for Groq? *(Privacy, DPA, Sub-processors)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** the EU-US Data Privacy Framework where a provider is certified, otherwise SCCs with a transfer impact assessment. Partial: the memo names no mechanism per provider, and the register still says "to confirm" for each.
20. Novera's model-provider router enforces data-class ceilings set from each provider's published
    terms. Is that a measure worth stating in Annex 1, and what wording avoids overstating it?
    *(DPA)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** yes, state the ceilings in DPA Annex 1. Built: the annex is generated from `src/lib/privacy/data-class.ts`, the table the router enforces.

## Cookies

21. Do the Supabase session cookie (400-day library default), `nv_ws` (one year), `nv_invite`
    (seven days), `nv_recovery` (fifteen minutes) and the `novera.motion` local-storage preference
    all fall within Legea 506/2004 Art. 4(6)(b) / ePrivacy Art. 5(3) strict necessity, so that no
    banner is needed? Should the session lifetime be shortened? *(Cookies)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** all strictly necessary or user-interface persistence; no banner. The memo's list leaves out `nv_invite`, which the code sets; the cookie notice keeps it.
22. First-party product events are recorded in production (stored server-side, nothing in the
    browser, the person only as a keyed hash, 13 months, including each view of a report). Is consent
    needed? *(Cookies, Privacy)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** no consent needed: server-side, keyed hashes, 13 months, no cross-site tracking. The 13 months matches the code (0062).

## AI Act

23. Is Novera a provider or deployer of an AI system within Art. 3, for (a) Ask Novera, (b)
    model-drafted support replies a person approves, (c) model grading? *(AI Testing Scope)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** Novera is the provider of its own evaluation platform, and neither provider nor deployer of the tested agent.
24. Does Art. 50(1) (informing people they interact with an AI system) apply to Ask Novera, and are
    the current disclosures adequate in wording and placement (the panel says questions go to model
    providers)? Art. 50 has applied since 2 August 2026. *(AI Testing Scope)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** yes; notices must say answers are generated by probabilistic models. Built: the Ask Novera panel now says it is an AI assistant, and each answer is labelled.
25. Does Art. 50(2) marking apply to text Novera's features generate, and does the Digital Omnibus
    (Reg. 2026/1744) transition to 2 December 2026 matter here? *(AI Testing Scope)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** applies to machine-generated test drafts and report summaries. Built: drafted scenarios, support drafts and diagnoses are labelled "drafted by a language model". Partial: the memo does not address the Digital Omnibus transition or machine-readable marking, and Novera's reports carry no model-written summary (findings quote grader rationales under a "Graded by" line).
26. Art. 4 now requires measures to support AI literacy (as amended by Reg. 2026/1744). What is
    proportionate for a one-person company? *(none drafted)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** satisfied through public documentation and guides. See the point to check: Art. 4 concerns the provider's own staff.
27. Could the product's marketing, or reports organised by "obligation codes", be read as offering a
    conformity assessment or legal advice? What wording keeps a report clearly "evidence of testing,
    not certification"? *(AI Testing Scope, Terms)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** enforced by the standing disclaimer that reports are testing evidence, not conformity assessments or certifications. Already built (`src/lib/legal/notices.ts`).

## Contract terms

28. Liability: cap, exclusions, and what Romanian law (or the chosen governing law) does not allow to
    be excluded. Particular risks: a false pass in a report a customer relied on; a scenario sent to
    an agent the customer was not authorised to test. *(Terms)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** cap at three months' fees, exclusion of indirect, consequential and regulatory-penalty losses; intent (dol) and gross negligence (culpă gravă) cannot be excluded under Romanian law. Terms 0.3 §14 names both carve-outs.
29. Authorisation to test: is the stored attestation enough to shift responsibility to the customer,
    and does unauthorised testing of a third party's AI agent raise criminal-law exposure (for
    example under Romanian rules on illegal access to computer systems) for Novera? *(Terms, AUP)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** customer warranties and attestations shift responsibility; the AUP prohibits unauthorised third-party scanning. Terms 0.3 §5 and AUP 0.2 say so. Partial: the memo does not address criminal-law exposure.
30. Governing law and forum for EU B2B customers. *(Terms)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** Romanian law, exclusive jurisdiction of the Bucharest courts (already drafted).
31. Data Act Chapter VI (switching between data processing services, in force since 12 September
    2025): does a SaaS like Novera fall under it, and what must the Terms say about export, switching
    and the deletion period? Novera has report exports and a full workspace export (owner or admin). *(Terms,
    DPA)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** met by the native JSON, Markdown and full workspace exports. Terms 0.3 §18 drafts switching; whether Chapter VI applies, and its periods, remain for counsel.
32. How must acceptance of a new version of the Terms be recorded? The product records none today.
    *(Terms)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** recorded immutably in `contract_acceptances` with timestamp, user, workspace and SHA-256 digests (built, 0068).
33. Sub-processor change notice: what period and channel, and what happens if a customer objects?
    *(DPA, Sub-processors)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** general written notice plus the public sub-processor register. Partial: no notice period or consequence of an objection; DPA 0.3 §7 keeps both as placeholders.

35. A run's attestation names the attesting member's email address and is sealed into every report
    for that agent, which the report's recipients see and which account deletion cannot remove. Is
    that justified (Art. 6, Art. 17), or should future attestations name a role or an id? *(Privacy)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** bind attestations to workspace roles and ids rather than personal data where feasible. Built 2026-10-16 for new agents (`src/lib/legal/attestation.ts`); agents connected earlier keep their frozen text.

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
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** satisfied by the layered checkbox flow accepting the unusual clauses (liability cap, auto-renewal, jurisdiction). Those three are already among §§2, 8, 10, 12, 14, 15, 17, so nothing was added.
37. **B2B verification.** The gate asks for the legal name, registered address, country, an optional
    VAT number (recorded as declared; Novera does not validate it) and the declarations. What
    verification is adequate for a B2B-only service, and what follows if a consumer gets through?
    *(Terms §2)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** name, address and VAT declarations at checkout; non-compliant registrations flagged or suspended.
38. **Liability cap.** Is three months' fees defensible under Romanian law, with or without a fixed
    floor, and which exclusions in §14 cannot be enforced? *(Terms §14)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** three months' fees is standard and defensible in B2B, provided non-excludable liabilities are preserved.
39. **Report terminology.** Novera's own surfaces now say "agent evaluation report" and carry a
    standing notice that a report is not a conformity assessment, certification or notified-body
    approval. Does any remaining use of "obligation" or "evidence" language still risk appearing as a
    statutory conformity assessment? *(AI testing scope, reports)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** purge "conformity assessment" and "compliance certificate" in favour of "Evaluation Evidence Report". Not adopted as written; see the point to check.
40. **Acceptance records after erasure.** Erasing a workspace deletes its acceptance records with it,
    as it deletes everything else. Must they be kept as evidence of the contract, and for how long?
    The records name the signer and their title. *(Privacy, retention)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** retain as contract-formation evidence for the civil limitation or accounting period. The code does not do this yet (see "Retention gap").
41. **Roles per data flow.** The DPA now proposes a role per activity (processor for testing,
    controller for accounts, billing and acceptance). Confirm or correct. *(DPA §1)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** confirmed: processor for test execution; controller for accounts, billing and acceptance ledgers.
42. **Accountant: VAT on cross-border B2B.** Directive 2006/112/EC Art. 196 (reverse charge) and Fiscal
    Code Art. 307(2): exact invoice wording, VIES validation, what happens with an invalid VAT number,
    prices net or gross, OSS if consumers ever buy, and non-EU customers. Stripe Tax stays off until
    this is answered. *(Refunds, Terms §10)* EUR-Lex could not be read when the drafts were updated,
    so neither text is among the dated sources.
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** accountant review of VIES verification, reverse-charge invoice annotations and non-EU billing logic before Stripe live. Recorded as a pre-live task in `docs/BILLING-DECISIONS.md`.

## Points in the founder's memo to check

These are why the memo cannot be relied on as it stands. Each is a reading by the build, not advice.

- **Fiscal Code Art. 307(2) (question 2).** As cited for Novera's own sales, it looks misdirected: it
  makes a Romanian *recipient* liable for services bought from abroad. For Novera's outbound B2B
  services the place-of-supply rule (Art. 278(2)) and the invoice mention "taxare inversă" appear to
  be what applies. Accountant to confirm.
- **VAT registration below the threshold (question 2).** The memo treats the RON 395,000 threshold as
  the trigger. A Romanian company that is not VAT-registered and supplies B2B services to customers in
  other member states appears to need a special registration (Fiscal Code Art. 317) *before* the first
  such supply, whatever its turnover. Accountant to confirm before the first EU sale.
- **Micro-enterprise rate (question 1).** The 1% rate, the EUR 100,000 ceiling and the 16% dividend tax
  are the memo's figures for 2026. Whether a software activity code ever attracts a different micro
  rate, and the other micro conditions (shareholding, consultancy revenue share), are for the
  accountant.
- **Retention period (question 3).** The memo says "5 to 10 years"; the brief that relayed it said 10.
  Law 82/1991 sets different periods for registers and for supporting documents. The accountant names
  the period per record class.
- **Competent authority, Law 365/2002 Art. 5(1)(f) (question 4).** That letter concerns the authority
  that *authorised* an activity, where one needs authorisation. ANPC and ANSPDCP are supervisory
  authorities, not an authorisation. The imprint lists them in a separate paragraph as a draft
  position, and the Art. 5(1)(f) field stays open.
- **OUG 34/2014 Art. 16(m) (question 6).** Letter (m) concerns digital content not on a tangible
  medium. Novera is a service; the exception for services appears to be Art. 16(a) (fully performed
  with prior express consent). Counsel to confirm.
- **Agencies (question 9).** If the agency is a controller, Novera is its processor, not a
  sub-processor. Novera is a sub-processor only when the agency is itself its client's processor. The
  DPA draft states both cases.
- **Storage limitation (question 13).** The memo relies on "archival and legal-defense exemptions".
  Archiving in the public interest (Art. 17(3)(d), Art. 89) does not fit a commercial service. For test
  evidence Novera is a processor, so the customer decides retention; for Novera's own records the
  ground would be legal claims (Art. 17(3)(e)). The Privacy draft uses the hash-integrity reasoning and
  the customer's control, not the archival exemption.
- **Pseudonymisation (question 14).** Pseudonymised data is still personal data (Recital 26), so
  account deletion is a mitigation, not erasure. There is also a second exception the memo does not
  mention: `erase_account` does not touch `contract_acceptances`, so a non-owner who accepted terms for
  another workspace stays named there (signer name and title) after deleting their account. The
  Privacy draft now says so.
- **DPO (question 15).** Art. 37(1)(b) is large-scale regular and systematic monitoring; (c) is
  large-scale special category data. The memo merges the two. The conclusion may hold; counsel to
  confirm on the right test.
- **AI literacy (question 26).** Public documentation addresses customers. Art. 4 concerns the
  provider's own staff and people operating AI on its behalf (and was amended by Reg. 2026/1744).
  Documentation does not answer it.
- **Report terminology (question 39).** The memo says to purge "conformity assessment" in favour of
  "Evaluation Evidence Report". That conflicts with the code and with the memo's own Part V: the phrase
  "conformity assessment" appears on Novera's surfaces only in the standing notice that a report is
  **not** one, which is the use counsel needs kept. Every customer-facing surface already calls the
  output an "agent evaluation report" (report page, exports since 2026-10-13); a search on 2026-10-16
  found no "conformity report", "compliance report" or "certificate" naming Novera's output. So nothing
  was renamed and the notice stays. One remaining use for counsel: the built-in suite eu-support v1–v5
  is named "EU support agent conformity suite". That name is sealed into the suite versions and every
  report that ran them; changing it means a new suite version (v6), not an edit.
- **Sub-processor notice (question 33).** Art. 28(2) needs the controller to be able to object. The memo
  gives no notice period and no consequence of an objection.
- **Liability (question 28).** Civil Code Art. 1355(2) also restricts excluding liability for harm to
  physical integrity or health. Terms §14 keeps "death or personal injury"; counsel to confirm the list.

## Retention gap: erasure versus what must be kept (questions 3 and 40)

What the code does today, read from the migrations on 2026-10-16. No database change was made: keeping
records past erasure changes a guarantee, and waits on the accountant and counsel.

- **`erase_workspace()` (current body in 0068)** deletes, among everything else: `contract_acceptances`
  (who accepted which texts, organisation, address, country, declared VAT number, signer name and
  title, hashes), `billing_events` (the billing audit trail), `billing_webhook_events`,
  `billing_subscription_history`, `billing_subscriptions`, `billing_entitlement_grants` and
  `billing_customers` (the workspace ↔ Stripe customer link). Only `erasure_log` (counts, no personal
  data) survives.
- **`erase_account()` (0058)** does not touch `contract_acceptances`: a member who accepted for a
  workspace they do not own stays named in it.
- **What survives elsewhere:** Stripe keeps invoices, receipts, the customer and the subscription. The
  issuer's duty to keep accounting documents is Novera's, so access to that Stripe account must outlive
  the workspace.
- **What the memo says must be kept:** invoices, transaction logs and billing ledger rows for the
  accounting period (5–10 years, Law 82/1991); acceptance records as contract-formation evidence for
  the civil limitation or accounting period.
- **Proposed migration shape, for after sign-off:** a `retained_records` table without a foreign key to
  `workspaces`, keyed by the erased workspace's id, holding a frozen JSON copy of each
  `contract_acceptances` row and the billing rows the accountant names, with `retained_because`
  (`accounting` or `contract_evidence`) and `retain_until` per row; `erase_workspace()` copies the rows
  there before deleting; append-only by trigger like 0068, readable by the service role only (the
  workspace no longer exists, so no member can read it), included in no export; a daily pass deletes
  rows past `retain_until`; a request from the person is answered from it under Art. 15. The Privacy
  Notice and retention schedule change in the same commit, and the CLAUDE.md line "leaves with its
  workspace" changes with it.

## Email and marketing

34. Novera sends only transactional email. If lifecycle or product-update emails are added, does Legea
    365/2002 Art. 6 require prior express consent for B2B recipients too? *(Privacy)*
    **Proposed answer (founder's memo, 2026-10-16) — awaiting counsel confirmation:** yes, prior express opt-in even for B2B. Checked 2026-10-16: no marketing email is sent, no form asks for marketing consent, nothing is pre-ticked, and `contract_acceptances.marketing_consent` is fixed false.

## Where the law may differ

Answers for Romania may not hold elsewhere. Flag where German (imprint, consumer, liability), UK
(UK GDPR, transfers back to the EU) or other targeted countries' rules differ, so the drafts can say
which jurisdiction each clause assumes.

## Everything still pending (as of 2026-10-16)

Every item below is open, waiting, or not yet confirmed. The questions above are unanswered; this list
is everything else that stands between today and a pilot or a paid launch. Live status:
the staff-only `/readiness` page. Ledger: `docs/LAUNCH-READINESS.md`.

### Out of reach for the code (the memo's own list)

- Formal sign-off of the draft legal suite (`/legal/*`) by retained Romanian/EU counsel, and of the tax
  positions by a certified accountant.
- Incorporating the SRL at the Trade Register (Registrul Comerțului): CUI and fiscal registration.
- Stripe live: live mode, the company's bank account, live tax configuration checked with the
  accountant.
- Production email: DNS for `support@` and `dmarc@` (MX), and a proven live transactional send.
- Vercel production tier, and Supabase point-in-time recovery or another verified backup schedule.

### For counsel

- Questions 1–42 above: each has a proposed answer from the founder's memo (2026-10-16); none is
  confirmed by counsel or the accountant.
- The points in the founder's memo to check, above.
- The retention gap above: confirm what must outlive erasure, then the migration.
- Review and approve every draft legal text (L1): privacy, terms, DPA, sub-processors, imprint, cookies, acceptable use, security, AI testing scope, refunds. All are `noindex` with the draft banner until approved.
- A privacy notice linked wherever personal data is collected: sign-up, support, apply (L3). Needs the approved privacy notice first.
- Governing law and forum (Romanian law, Bucharest courts proposed; no arbitration).
- How and how early changes to the terms and sub-processors are announced.
- The effective date of the legal texts (after sign-off).
- Attestations: since 2026-10-16 a new one names a role and a user id, not the email (question 35). Confirm that, and what to say about agents connected earlier, whose frozen text still names an email.
- Consent for first-party product events (the analytics salt question).
- The public page `/solutions/eu-ai-act` names AI Act articles (counted from the suite's duty references) and is live: review its wording.
- The report wording "testing evidence, not a certification" across reports, exports, `/verify` and the print footer: confirm it is enough.

### For the accountant

- Legal form: the memo proposes an SRL on the micro-enterprise regime (question 1).
- The VAT points to check above: Art. 307(2), and Art. 317 registration before the first intra-EU sale.
- Accounting retention per record class, and whether Novera must keep its own billing rows after
  erasure (retention gap above).
- VAT: prices shown with or without VAT (D1); reverse-charge invoice wording; VIES validation; invalid VAT numbers; non-EU customers (question 42). Stripe Tax stays off until answered.
- Romanian VAT registration status and any recapitulative statements.

### For David: the legal entity and the paid launch

- Register the entity (the memo proposes an SRL; not yet incorporated) and fill `data/legal/entity.ts`: legal name, form, registered office, Trade Register number, CUI, VAT ID if any, share capital (now required), representative, phone (L7). Live checkout refuses until it is complete.
- A privacy contact mailbox. The only address already shown publicly is `support@nover.space`, which bounces until O13 is done; no privacy address was invented.
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
