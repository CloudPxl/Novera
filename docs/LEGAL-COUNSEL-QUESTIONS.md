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
22. For planned first-party product measurement that stores nothing in the browser, is consent
    needed? *(Cookies)*

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
    and the deletion period? Novera has report exports but no full workspace export yet. *(Terms,
    DPA)*
32. How must acceptance of a new version of the Terms be recorded? The product records none today.
    *(Terms)*
33. Sub-processor change notice: what period and channel, and what happens if a customer objects?
    *(DPA, Sub-processors)*

## Email and marketing

34. Novera sends only transactional email. If lifecycle or product-update emails are added, does Legea
    365/2002 Art. 6 require prior express consent for B2B recipients too? *(Privacy)*

## Where the law may differ

Answers for Romania may not hold elsewhere. Flag where German (imprint, consumer, liability), UK
(UK GDPR, transfers back to the EU) or other targeted countries' rules differ, so the drafts can say
which jurisdiction each clause assumes.
