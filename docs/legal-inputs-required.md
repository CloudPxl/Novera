# Legal inputs required

Every fact or decision the legal drafts under `/legal` still need, per document. The drafts live
in `data/legal/*.ts` and render at `/legal/<slug>`; each bracketed capital phrase there is one of
the items below and is highlighted on the page. Nothing here may be filled with a guess: a field
is completed only from a registration document, a signed agreement, a provider's published terms,
or counsel's written answer.

Drafted 2026-10-09 against HEAD `1b7d026`. Questions for the lawyer and the accountant are in
`docs/LEGAL-COUNSEL-QUESTIONS.md`.

**Owner key:** David = founder fact or decision · Counsel = lawyer · Accountant · Provider =
verify in the provider's dashboard or published terms, then record the URL and date.

## Shared across documents (fill once)

| Placeholder | Owner | Where it appears |
|---|---|---|
| `[LEGAL ENTITY NAME]` | David | Privacy, Terms, DPA, Imprint |
| `[LEGAL FORM]` (for example SRL, PFA, or another country's form) | David + Accountant | Privacy, Imprint |
| `[REGISTERED ADDRESS]` | David | Privacy, Terms, DPA, Imprint |
| `[TRADE REGISTER NAME AND NUMBER]` (ONRC number, or equivalent) | David | Privacy, Imprint |
| `[TAX REGISTRATION CODE]` (CUI) | David | Imprint |
| `[VAT ID, OR A STATEMENT THAT THE ENTITY IS NOT VAT-REGISTERED]` | Accountant | Imprint |
| `[CONTACT EMAIL]`, `[PRIVACY CONTACT EMAIL]`, `[SUPPORT CONTACT]`, `[ABUSE CONTACT EMAIL]`, `[SECURITY CONTACT EMAIL]` | David (mailboxes must exist and be read) | Terms, Privacy, Cookies, Imprint, AUP, Security |
| `[POSTAL ADDRESS FOR PRIVACY REQUESTS]` | David | Privacy |
| `[EFFECTIVE DATE]` | David, after counsel signs off | Privacy, Terms, Sub-processors |
| `[NOTICE METHOD]`, `[NOTICE PERIOD]` for changes to terms, notices and sub-processors | David + Counsel | Privacy, Terms, DPA, Sub-processors |

## Privacy Notice (`/legal/privacy`)

1. DPO: designated or not, with reasons (GDPR Art. 37). Counsel.
2. Role allocation per data category, in particular the audit trail, run attestations and Ask
   Novera conversations (controller, processor or joint). Counsel.
3. Legal basis for each purpose in the table, and a legitimate-interests assessment for abuse
   prevention and security. Counsel.
4. Legal basis for assistant memory (contract or consent). Counsel.
5. Accounting-record retention once billing exists. Accountant.
6. Transfer mechanism for each model provider and infrastructure provider. Counsel + Provider.
7. What Vercel and Supabase log (IP, user agent, paths) and for how long. Provider.
8. Supabase backup retention and deletion for this project's plan. Provider.
9. Confirmation that no processing is an Art. 22 decision. Counsel.
10. Whether keeping verdicts and reports until workspace erasure, with no fixed end, is justified;
    and how long invitation addresses of people who never accepted may stay. Counsel.
11. Response process and time limit for rights requests. Counsel.
12. Lead supervisory authority (ANSPDCP is drafted as the Romanian authority). Counsel.
13. Minimum age, if any. Counsel.

**Depends on the code:** the sentence "diagnosis, scenario drafting and Suite Builder extraction
still use Novera's own providers" on a workspace's own key describes launch-readiness item E. When
E is fixed, update this notice and the Sub-processors page in the same commit.

## Terms of Service (`/legal/terms`)

1. B2B only, or consumers too. This decides the shape of the whole document. David + Counsel.
2. Service level, support hours and response targets, or a statement that there are none. David.
3. Feedback licence. Counsel.
4. Plans, prices, currency, VAT treatment, billing period, payment method and provider (Stripe is
   planned, sandbox only). David + Accountant.
5. Suspension and termination: grounds, notice, consequences. Counsel.
6. Data export and switching obligations (Data Act Chapter VI), and the period before deletion after
   termination. Counsel. A full workspace export is launch-readiness item O6, not yet built.
7. Warranty, liability cap, exclusions, indemnities. Counsel.
8. Governing law and forum. David + Counsel.
9. If consumers are served: complaint and alternative dispute resolution information. Counsel.
10. How acceptance of a new version is recorded (the product records no acceptance today). Counsel +
    code change.
11. Review of the model-provider limitation. Counsel.

## Data Processing Agreement (`/legal/dpa`)

1. Customer and Novera roles (an agency testing a client's agent may itself be a processor, which
   makes Novera a sub-processor). Counsel.
2. Data subjects and categories as the customer confirms them; special category data. Counsel.
3. Instructions clause, including a legal requirement to process. Counsel.
4. Confidentiality commitments for the founder and any staff or contractors. Counsel.
5. Sub-processor notice period, method and the consequence of an objection. Counsel + David.
6. Each provider's own DPA: accepted or signed, with date and URL. Provider.
7. DSR response times; breach notification content, channel and target time; an incident procedure
   (not yet written). David + Counsel.
8. Audit scope, notice and cost. Counsel.
9. Deletion after termination; whether report exports suffice until a workspace export exists.
   Counsel.
10. Supabase backup deletion. Provider.
11. Transfer mechanism and any transfer impact assessment. Counsel.
12. Annex 1 (measures) completed and dated at signature; Annex 2 (sub-processors) attached as a
    dated list. David.
13. Whether Novera's own processing needs a DPIA. Counsel.

## Sub-processors (`/legal/subprocessors`)

Locations are stated only where the repository verifies them (Supabase `eu-central-1`, Vercel
functions `fra1` per `vercel.json`). For every other provider, record from its published terms or
dashboard, with the URL and date read:

| Provider | Processing location | DPA in place | Transfer mechanism |
|---|---|---|---|
| Supabase | backups, logs, support access | ? | ? |
| Vercel | build and log storage; edge network | ? | ? |
| Resend | all | ? | ? |
| Groq | all | ? (data-class.ts records "processor under a DPA") | ? |
| Mistral AI | all | ? | ? |
| OpenRouter | all | ? | ? |
| Google (Gemini API) | all; and whether the key is configured in production | ? | ? |

Also: re-verify the data-class ceilings in `src/lib/privacy/data-class.ts` against each provider's
current terms (last read 2026-09-29), and decide the change-notice mechanism.

## Cookies and storage (`/legal/cookies`)

1. Confirm each entry qualifies for the strictly-necessary exemption, in particular the 400-day
   Supabase session cookie lifetime (library default) and the `novera.motion` local-storage
   preference. Counsel.
2. Whether the planned first-party product measurement (launch-readiness O3) needs consent. Counsel.
3. `nv_recovery` is in the password-reset fix that is not yet merged; remove the row if that change
   does not ship.

## Imprint (`/legal/imprint`)

All fields, from the registration certificate: name, form, registered office, register number, CUI,
VAT status, share capital (if the form requires it to be stated), telephone (if required),
responsible representative, competent authority (or none). Counsel to confirm which fields the
chosen form requires, and whether targeting Germany or another country requires more.

## Acceptable Use (`/legal/acceptable-use`)

1. Enforcement: investigation, suspension, termination, reporting. Counsel.
2. Abuse contact mailbox. David.

## Security and data flow (`/legal/security`)

1. Security contact mailbox and a vulnerability disclosure policy. David.
2. Update the "Not yet in place" list at publication (incident procedure, restore drill, monitoring,
   CI, independent assessment: launch-readiness O1, O4, O5).

## AI Testing Scope and Limitations (`/legal/ai-testing-scope`)

1. Whether AI Act Art. 50 applies to Ask Novera, support drafting or grading, in which role, and
   whether the in-product disclosures are adequate in wording and placement. Counsel.

## Refunds and cancellation (`/legal/refunds`)

Everything, once the commercial model exists: plans, cancellation, refunds (including for an errored
run), consumer withdrawal if consumers can buy, and tax on refunds and credit notes. David + Counsel +
Accountant.

## Sources consulted (all read 2026-10-09)

EUR-Lex returned an empty 202 (bot challenge) to every request on 2026-10-09; the EU acts were read
from the Publications Office Cellar copy of the same Official Journal text
(`http://publications.europa.eu/resource/celex/<CELEX>`).

| Source | URL | Kind |
|---|---|---|
| GDPR, Reg. (EU) 2016/679 (Arts 13, 28, 33, 37 read; others cited by number) | https://eur-lex.europa.eu/eli/reg/2016/679/oj | Law |
| AI Act, Reg. (EU) 2024/1689 (Arts 3, 4, 50, 113) | https://eur-lex.europa.eu/eli/reg/2024/1689/oj | Law |
| Digital Omnibus on AI, Reg. (EU) 2026/1744 (Art. 4 amended; Art. 50(2) transition to 2 Dec 2026) | https://eur-lex.europa.eu/eli/reg/2026/1744/oj/eng | Law |
| Commission FAQ on AI Act Article 50 | https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act | Official guidance |
| Data Act, Reg. (EU) 2023/2854 (application dates; Art. 25 switching terms) | https://eur-lex.europa.eu/eli/reg/2023/2854/oj | Law |
| ePrivacy Directive 2002/58/EC (original text only) | https://eur-lex.europa.eu/eli/dir/2002/58/oj | Law |
| ODR platform discontinuation, Reg. (EU) 2024/3228 | https://eur-lex.europa.eu/eli/reg/2024/3228/oj | Law |
| EDPB Guidelines 07/2020, controller and processor (v2.0, 7 July 2021) | https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-072020-concepts-controller-and-processor-gdpr_en | Official guidance |
| EDPB Opinion 22/2024, processors and sub-processors (announcement read; PDF did not extract) | https://www.edpb.europa.eu/news/news/2024/edpb-adopts-opinion-processors-guidelines-legitimate-interest-statement-draft_en | Official guidance |
| WP248 rev.01, DPIA (EDPB-endorsed; landing page only) | https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/data-protection-impact-assessments-high-risk-processing_en | Official guidance |
| Legea 365/2002, comerțul electronic (Arts 5, 6) | https://legislatie.just.ro/Public/DetaliiDocument/37075 | Law (RO) |
| Legea 506/2004 (Art. 4(5)–(6), cookies) | https://legislatie.just.ro/Public/DetaliiDocument/56973 | Law (RO) |
| OUG 34/2014, consumer rights (Arts 2, 9, 16) | https://legislatie.just.ro/Public/DetaliiDocument/158913 | Law (RO) |
| ANSPDCP contact page | https://www.dataprotection.ro/?page=contact&lang=ro | Authority |
| ANPC | https://anpc.ro/ | Authority |

No practitioner commentary was relied on.

**Not yet researched:** the consolidated text of ePrivacy Art. 5(3) as amended by Directive
2009/136/EC; whether Legea 506/2004 has a later consolidated form; EDPB guidance on cookies
(Guidelines 2/2023 on the technical scope of Art. 5(3)); German imprint rules (§ 5 DDG) if Germany
is targeted; the full Digital Omnibus on AI; Romanian accounting-record retention; each provider's
DPA and transfer terms.
