/**
 * Privacy Notice — DRAFT for legal review.
 *
 * Sources consulted (read 2026-10-09): GDPR (Reg. 2016/679) Articles 13 (information
 * duties, the structure of this notice), 28, 33 and 37; EDPB Guidelines 07/2020
 * (controller and processor); AI Act (Reg. 2024/1689) Article 50; ANSPDCP contact page.
 *
 * Every category, recipient and period below was read from the code and the published
 * documentation on 2026-10-09: supabase/migrations 0009, 0024, 0037, 0038, 0054, 0056;
 * src/lib/support, src/lib/privacy/data-class.ts, src/lib/router/routes.ts,
 * data/docs/data-and-privacy.md, data/docs/ask-novera.md. Legal bases and role
 * allocation are proposals for counsel, never conclusions.
 */
import type { LegalDocument } from "./types.ts";
import { retentionTable } from "./retention.ts";

export const privacy: LegalDocument = {
  slug: "privacy",
  title: "Privacy Notice",
  summary: "What personal data Novera processes, why, with whom, for how long, and the rights people have.",
  status: "draft",
  version: "0.2 draft",
  lastReviewed: "2026-10-13",
  sources: ["gdpr", "edpb-07-2020", "ai-act", "ai-art50-faq", "anspdcp"],
  body: `This notice explains how Novera handles personal data. It describes what the product does today, read from its code. It is a draft: the company details, the legal bases and the allocation of roles must be completed and confirmed by counsel before it is published.

**Effective date:** [EFFECTIVE DATE]. **Version:** 0.1 draft.

## Who is responsible

The service is operated by [LEGAL ENTITY NAME], [LEGAL FORM], with its registered office at [REGISTERED ADDRESS], registered under [TRADE REGISTER NAME AND NUMBER].

- Privacy contact: [PRIVACY CONTACT EMAIL]
- Postal address for privacy requests: [POSTAL ADDRESS FOR PRIVACY REQUESTS]
- Data protection officer: [DPO NAME AND CONTACT, OR A STATEMENT THAT NONE IS DESIGNATED — COUNSEL TO CONFIRM UNDER GDPR ARTICLE 37]

## Two roles: Novera's and its customers'

Novera processes some personal data for its own purposes and some on behalf of the customers who use it to test their AI agents. The allocation below is a proposal. [LAWYER REVIEW REQUIRED: CONFIRM EACH ROLE, IN PARTICULAR THE AUDIT TRAIL, THE RUN ATTESTATION AND ASSISTANT CONVERSATIONS.]

| Data | Proposed role of Novera | Why |
| --- | --- | --- |
| Accounts, sign-in, profiles, preferences | Controller | Novera decides why and how it is processed, to provide the service |
| Support messages and trial applications | Controller | Sent to Novera about Novera |
| Ask Novera conversations and memory | Controller | [COUNSEL TO CONFIRM] |
| Abuse prevention (hashed addresses, rate counters) | Controller | Protects the service |
| Agents, policies, scenarios, agent replies, transcripts, verdicts, reports, Suite Builder sources, production failures sent to the API | Processor, on the customer's instructions | The customer decides what to test, against what, and with what data |
| Workspace membership, roles, audit trail, run attestations | [COUNSEL TO CONFIRM: CONTROLLER, PROCESSOR OR JOINT] | Serves both the customer's governance and Novera's security |

Where Novera acts as a processor, the customer is the controller and its own privacy notice applies. The Data Processing Agreement governs that processing.

## What personal data Novera processes

**Account and sign-in.** An email address and a password, held by Novera's authentication provider; Novera's own code never stores the password. A person who signs in with Google or GitHub also has that provider's account identifier and the details the provider returns linked to their account. Changes to sign-in methods, password changes and signing out everywhere are recorded in the audit trail.

**Profile and preferences.** Display name, job title, company name, locale, timezone, date and motion preferences, notification preferences, onboarding status, account mode, default workspace, agent and suite, report format, and whether assistant memory is on. Profiles are used only to show Novera to the person; they are never read by grading, suites, policies or reports.

**Workspace membership.** Which workspaces a person belongs to and with which role (owner, admin, operator, reviewer, auditor). An invitation stores the invitee's email address, the role, who invited and when; the invitation link itself is stored only as a SHA-256 hash.

**Run attestations.** Each test run records who declared that they own or are authorised to test the agent, when, and the text they declared. That text names the declaring member's email address, and it is sealed into every report of that agent's runs, so anyone holding a report link sees it and it stays in sealed reports after the member's account is deleted. [COUNSEL TO CONFIRM THE LEGAL BASIS, AND WHETHER A NAME OR ROLE SHOULD REPLACE THE ADDRESS IN FUTURE ATTESTATIONS.]

**Agent connections.** Agent names, web addresses and settings. Agent authentication headers and model API keys are encrypted before storage.

**Test evidence.** The messages each scenario sent and what the agent replied, including whole conversations and tool activity. This is where personal data appears if the agent under test reveals it. Verdicts, the graders' reasons and a SHA-256 fingerprint of each reply are kept with it.

**Sealed reports.** Verdicts, counts, coverage, model names, dates and the run's attestation (above). Anything shaped like personal data that a grading model quoted is replaced with a placeholder before sealing. Reports do not contain the agent's replies.

**Suite Builder sources.** The text of a document, page or tool list a customer adds, with email addresses, phone numbers, card numbers, IBANs and IP addresses replaced before it is saved. The file itself is not kept, only its SHA-256 hash.

**Production failures sent through the API.** Stored redacted; the original only as a hash.

**Contract acceptance and business details.** Before a paid plan starts, an owner or admin gives the organisation's legal name, registered address, country and, if it has one, VAT number, their own name and title, and confirms business purpose and authority. Novera records that with the person's account, the time, the browser's user agent and the version and SHA-256 fingerprint of each document accepted, as evidence of the contract. The legal name and address also go to the payment provider as billing details. Novera does not record the IP address here. [COUNSEL TO CONFIRM THE LEGAL BASIS — LIKELY CONTRACT AND LEGAL OBLIGATION — AND THE RETENTION PERIOD.]

**Support messages and trial applications.** Email address, organisation (optional), the message with any key, card number or IBAN removed before storage, the replies drafted for it and their approval and sending status.

**Ask Novera.** The questions a person asks and the answers given, visible only to that person. Assistant memory exists only if the person turns it on, and holds only what they choose to save.

**Product events.** Novera records what happens in the product — for example a sign-up confirmed, a run started, a report viewed — with the workspace, the time and a few fixed properties. The person is stored only as a keyed hash, never as an email address or name, and nothing is stored in the browser. Kept for 13 months.

**API activity.** API keys are stored only as an HMAC. Each read of an agent's raw replies through the API or MCP is recorded with the key, the run and the route.

**Abuse prevention.** The IP address of a support message, a trial application or a sign-in attempt is combined with other details and a secret and stored only as a salted hash, to count requests. Novera's code does not store the address itself.

**Infrastructure logs.** Novera's hosting and authentication providers may record technical data such as IP addresses, browser details and requested addresses in their own logs. [TO VERIFY WITH VERCEL AND SUPABASE: WHAT IS LOGGED AND FOR HOW LONG.]

## Purposes and legal bases

Every legal basis below is a proposal. [COUNSEL TO CONFIRM EACH LEGAL BASIS, AND WHERE LEGITIMATE INTERESTS IS RELIED ON, THE BALANCING TEST.]

| Purpose | Data | Proposed legal basis (counsel to confirm) |
| --- | --- | --- |
| Provide accounts, workspaces and the service | Account, profile, membership | Performance of a contract (GDPR Article 6(1)(b)) |
| Run tests and produce reports for customers | Test evidence, reports, sources | Processing on the customer's instructions; the customer determines its own legal basis |
| Answer support questions and trial applications | Support and application data | Steps before a contract or legitimate interests (Article 6(1)(b) or (f)) |
| Keep the service secure and prevent abuse | Hashed addresses, rate counters, audit trail | Legitimate interests (Article 6(1)(f)) |
| Ask Novera answers | Conversations | [COUNSEL TO CONFIRM] |
| Assistant memory | Saved preferences | [COUNSEL TO CONFIRM: CONTRACT OR CONSENT] |
| Transactional email | Email address, message content | Performance of a contract |
| Accounting and tax records, once billing exists | Billing details | Legal obligation (Article 6(1)(c)) — [ACCOUNTANT TO CONFIRM] |

Novera sends no marketing email. Any future marketing email would be sent only where the law allows, which may require prior express consent. [COUNSEL TO CONFIRM.]

## How model providers are used

Grading, drafting support replies, diagnosing failures, Suite Builder extraction and Ask Novera send text to language model providers.

- **On Novera's own keys** (a workspace without its own key: the trial), requests go to Groq and Mistral AI. Novera's own support-reply drafting also uses them. OpenRouter and Google's free tier are approved only for material Novera wrote itself, and every product feature sends customer material, so in practice they receive nothing from the service; they are used only by Novera's internal measurement scripts.
- **On a workspace's own key**, grading and Ask Novera use only that key's provider (Groq, Google AI Studio, OpenRouter or Anthropic), under the customer's own agreement with it. Since 2026-10-09 the same holds for diagnosis, scenario drafting and Suite Builder extraction: a workspace with its own key is served on that key only, with no fallback to Novera's providers, and each such operation is recorded with the provider, model and funding source (never the content).
- API keys, agent authentication headers and the body of a read-back response are never sent to a model.

**Processing outside the EU.** Novera's database is in Frankfurt and its server functions run in Frankfurt, but Novera does not keep all processing inside the EU. Groq is operated from the United States, so a trial run sends agent replies outside the EU. The providers a customer can choose for its own key also process outside the EU. [TRANSFER MECHANISM FOR EACH PROVIDER — COUNSEL TO CONFIRM.] The Sub-processors page lists every provider.

**Automated processing.** Verdicts are findings about an AI agent's behaviour, produced by rules and by language models. They are not decisions about the people whose data may appear in the evidence. Support replies are drafted by a model and sent only after a person approves them; questions about money, personal data, contracts or security go straight to a person. Ask Novera answers are generated by a model, in a panel that says questions go to language model providers. [COUNSEL TO CONFIRM THAT NO PROCESSING FALLS UNDER GDPR ARTICLE 22.]

## Who receives personal data

- Novera's sub-processors, listed on the Sub-processors page.
- Members of a workspace, according to their role.
- Anyone holding the link to a sealed report. A link is long and random, expires after 30 days unless set otherwise, and can be withdrawn at once.
- Webhook receivers a customer configures, which receive counts and links, never replies.
- Public authorities, where the law requires it.

## How long data is kept

${retentionTable()}

[COUNSEL TO CONFIRM THAT KEEPING VERDICTS AND REPORTS UNTIL WORKSPACE ERASURE, WITH NO FIXED END, IS JUSTIFIED.]

## Your rights

Under the GDPR you may ask for access to your personal data, its correction or erasure, restriction of processing, data portability, and you may object to processing based on legitimate interests. Where processing rests on consent, you may withdraw it at any time.

- **Download my data** under Settings gives a signed-in person their profile, memberships, memory, conversations and own events as a file.
- **Delete my account** under Settings erases the workspaces the person owns, ends their memberships elsewhere, revokes their keys there, and deletes their profile, conversations and memory. What they did in other people's workspaces stays as evidence, attributed to an identifier without their name or email — except that an attestation they made names their email address, and a report already sealed with it cannot change.
- Any other request: [PRIVACY CONTACT EMAIL]. [RESPONSE PROCESS AND TIME LIMIT — COUNSEL TO CONFIRM.]

Where Novera processes data on a customer's behalf, Novera passes the request to that customer and helps it answer. [COUNSEL TO CONFIRM.]

**Complaints.** You may complain to a data protection supervisory authority, in particular in the EU country where you live, work or where the alleged infringement took place. For Romania this is the Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP), B-dul G-ral. Gheorghe Magheru 28-30, Sector 1, 010336 București, dataprotection.ro. [COUNSEL TO CONFIRM THE LEAD SUPERVISORY AUTHORITY.]

## Security

Model keys and agent credentials are encrypted at rest, database access is limited by row-level security, evidence cannot be edited once recorded, and reports carry a SHA-256 hash. The Security and data flow page describes what the code does. No system is free of risk, and this notice makes no certification claim.

## Cookies

Novera uses only the cookies needed to sign in and stay in the right workspace, and no analytics or advertising cookies. The Cookies and storage page lists each one.

## Children

Novera is a service for organisations and is not directed at children. [MINIMUM AGE, IF ANY — COUNSEL TO CONFIRM.]

## Changes to this notice

Each version carries a date. Material changes will be announced to account holders by [NOTICE METHOD] before they take effect.`,
};
