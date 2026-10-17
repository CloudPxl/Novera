/**
 * Data Processing Agreement — DRAFT for legal review. Not final, not sufficient on its own.
 *
 * Sources consulted (read 2026-10-09): GDPR Article 28(1)–(4) (text read in full for this
 * draft), Articles 32–36 and 44–49 (named for counsel); Article 33(2) (a processor
 * notifies the controller without undue delay); EDPB Guidelines 07/2020; EDPB Opinion
 * 22/2024; WP248 rev.01 (DPIA).
 *
 * The structure follows the elements Article 28(3) lists. What Novera does for each was
 * read from the code (retention passes in 0037/0038/0056, erasure in 0054, encryption in
 * src/lib/crypto.ts). It is a skeleton for counsel, not a contract.
 *
 * Version 0.3 (2026-10-16) adopts the founder's memo of that date as the draft position: the role
 * split, agencies with Novera as sub-processor, customer-configured services outside Novera's
 * sub-processors, no DPIA for Novera's own processing with assistance for the customer's, transfers
 * under the Data Privacy Framework or standard contractual clauses. Annex 1's data-class ceilings
 * are generated from src/lib/privacy/data-class.ts, the table the model router enforces, so the
 * annex cannot say something the router does not do.
 */
import type { LegalDocument } from "./types.ts";
import { PROVIDER_REGISTER, REGISTER_VERSION } from "./register.ts";
import { CONNECTION_CEILINGS, DATA_CLASSES, DATA_POLICY_VERSION, describeClass, type DataClass } from "../../src/lib/privacy/data-class.ts";

/** Novera's own connections as the register names them; a connection with no funded key is said so. */
const CONNECTION_LABEL: Record<string, string> = {
  groq: "Groq",
  mistral: "Mistral AI",
  google: "Google (Gemini API, free tier)",
  openrouter: "OpenRouter (free models)",
  openai: "OpenAI (no key configured)",
  anthropic: "Anthropic (no key configured)",
};

const CLASS_MEANING: Record<DataClass, string> = {
  public: "Novera's own public material, such as documentation",
  synthetic: "material written by Novera or generated for testing, such as suite scenarios",
  redacted_customer: "a customer's material with detectable personal data replaced by placeholders",
  identifiable_customer: "a real person's words or details, such as an agent's unredacted reply",
  special_category: "GDPR Article 9 data; never detected automatically, only declared",
};

/**
 * The data-class ceilings, as Annex 1 states them: the classes in order, then the most sensitive
 * class each of Novera's own connections may receive. Read from the router's table.
 */
export function dataClassAnnex(): string {
  const classes = DATA_CLASSES.map((c, i) => `${i + 1}. **${describeClass(c)}**: ${CLASS_MEANING[c]}.`);
  const ceilings = Object.entries(CONNECTION_CEILINGS).map(([name, ceiling]) => `| ${CONNECTION_LABEL[name] ?? name} | up to ${describeClass(ceiling)} |`);
  return [
    `Every request to a language model is classed before it is sent, and a provider receives it only if its ceiling allows that class (data policy version ${DATA_POLICY_VERSION}). Detected personal data can only raise a request's class; redaction lowers a class detection raised, never one the caller declared. The classes, from least to most sensitive:`,
    "",
    ...classes,
    "",
    "| Novera's own connection | Most sensitive class it may receive |",
    "| --- | --- |",
    ...ceilings,
    "",
    "A connection to the customer's own key may receive any class: the customer chose that provider and its terms. The ceilings are set from each provider's published data-use terms for the plan Novera is on. Patterns detect email addresses, phone numbers, card numbers, IBANs, IP addresses and credentials; names and street addresses are not detected, so this measure reduces what reaches a provider and does not guarantee it. [COUNSEL TO CONFIRM THIS WORDING DOES NOT OVERSTATE THE MEASURE.]",
  ].join("\n");
}

export const dpa: LegalDocument = {
  slug: "dpa",
  title: "Data Processing Agreement",
  summary: "The terms for personal data Novera processes on a customer's behalf. A skeleton for counsel, not a final agreement.",
  status: "draft",
  version: "0.3 draft",
  lastReviewed: "2026-10-16",
  sources: ["gdpr", "edpb-07-2020", "edpb-opinion-22-2024", "edpb-dpia"],
  body: `**This draft is not final and is not sufficient on its own.** It records what Novera's service does with personal data, arranged under the headings a processing agreement needs. It must be completed and reviewed by counsel, and may be replaced by standard contractual clauses or by the customer's own form.

## 1. Parties and roles

- Customer: [CUSTOMER LEGAL NAME AND ADDRESS], acting as controller, or as a processor for its own client.
- Novera: [LEGAL ENTITY NAME], [REGISTERED ADDRESS], acting as the Customer's processor, or as its sub-processor where the Customer is itself a processor.

**Agencies.** An agency that uses Novera to test a client's agent may be that client's processor. Novera is then a sub-processor in the client's chain, and this agreement is the agency's agreement with its sub-processor: the agency remains responsible for passing on its client's instructions and for its own agreement with the client. One agency workspace per client keeps each client's evidence apart. [DRAFT POSITION — COUNSEL TO CONFIRM THE STRUCTURE, INCLUDING WHETHER A CLIENT NEEDS ANY DIRECT RIGHT AGAINST NOVERA.]

The likely allocation, for counsel to confirm against how the product is actually configured — a contract cannot declare a role the facts do not support:

| Activity | Likely role of Novera | Why |
| --- | --- | --- |
| Testing the customer's agent: scenarios, replies, policies, sources, verdicts, reports | Processor (the customer is usually the controller) | The customer decides why its data is evaluated |
| Accounts, authentication records, billing, contract acceptance, security and abuse records, product events | Independent controller | Novera decides these purposes |
| Workspace audit trail and run attestations | Processor for the customer's governance record; controller for Novera's security and abuse records | One record, two purposes |
| Support conversations with Novera | Controller | Novera's own relationship with the person asking |
| Routing a workspace's model work to the customer's own key | Processor acting on the customer's configuration | The customer chose the provider |
| Grading on Novera's keys (trial, Agency Pro managed runs) | Processor, with Novera choosing the model providers | Novera selects part of the means; listed in Annex 2 |
| A shared report link | Processor for the content, controller for its own access security | The customer decides who receives the link |

The services a customer chooses and configures are not Novera's sub-processors in this draft: the model provider behind the customer's own key, the agent under test, a read-back endpoint and webhook receivers. Novera sends them data only as the customer's configuration instructs, and the customer's own agreement with each governs it.

[DRAFT POSITION FROM THE FOUNDER'S MEMO OF 2026-10-16. LAWYER REVIEW REQUIRED: THE ROLE ALLOCATION, INCLUDING THE AUDIT TRAIL, RUN ATTESTATIONS AND CUSTOMER-CONFIGURED SERVICES.]

## 2. Subject matter, duration, nature and purpose

- **Subject matter:** testing the customer's AI support agent against scenario suites and the customer's policies, and producing reports.
- **Duration:** for as long as the customer's workspace exists, then until deletion under section 9.
- **Nature:** sending scenarios to the customer's agent; storing its replies; grading them with rules, an optional read-back and language models; storing verdicts and sealed reports; redacting Suite Builder sources and production failures; hosting.
- **Purpose:** to give the customer evidence of how its agent behaves.

## 3. Data subjects and categories of data

- **Data subjects:** the customer's workspace members; any person whose data appears in what the customer's agent replies, in the customer's policies, sources or production failures, or in scenarios the customer writes. [CUSTOMER TO CONFIRM; NOVERA ASKS THAT SCENARIOS USE TEST DATA.]
- **Categories:** contact and account details of members; whatever the agent under test returns, which may include any category of personal data. Special category data is not expected and is never detected automatically. [COUNSEL TO CONFIRM HOW SPECIAL CATEGORY DATA IS ADDRESSED.]

## 4. Instructions

Novera processes the personal data only on the customer's documented instructions. The customer's instructions are these terms, the configuration it sets in the product (agents, suites, retention period, API keys and their scopes, webhooks), and any further written instruction agreed between the parties. Novera will tell the customer if, in its opinion, an instruction infringes data protection law. [COUNSEL TO COMPLETE, INCLUDING THE HANDLING OF A LEGAL REQUIREMENT TO PROCESS.]

## 5. Confidentiality

Persons Novera authorises to process the data are bound to confidentiality. [COUNSEL TO CONFIRM THE COMMITMENTS REQUIRED OF THE FOUNDER AND ANY FUTURE STAFF OR CONTRACTORS.]

## 6. Security

Novera applies the measures in Annex 1. Annex 1 describes what the code does; it is not a certification.

## 7. Sub-processors

The customer gives general authorisation for the sub-processors in Annex 2. Novera will give general written notice of an intended addition or replacement [NOTICE PERIOD] before it takes effect: by updating the public Sub-processors page and its machine-readable copy (/legal/subprocessors.json), and by [NOTICE METHOD]. The customer may object on reasonable data-protection grounds. [COUNSEL TO DRAFT THE CONSEQUENCE OF AN OBJECTION.] Novera imposes data-protection obligations on each sub-processor by contract and remains responsible for it. [TO VERIFY: EACH PROVIDER'S OWN DATA PROCESSING TERMS, ACCEPTED OR SIGNED.]

## 8. Assistance

- **Data subject requests:** the product lets the customer find, export and erase data in its workspace; Novera passes on any request it receives and helps where the product cannot. [RESPONSE TIMES.]
- **Security, impact assessments and prior consultation:** Novera provides the information in Annex 1 and on the Security and data flow page, and answers reasonable questions, including for the customer's own data protection impact assessment and AI governance documentation. Draft position: Novera's own processing does not need an impact assessment, because it evaluates an AI agent's behaviour rather than people. [COUNSEL TO CONFIRM AGAINST THE WP248 CRITERIA, GIVEN THAT AGENT REPLIES MAY CONTAIN ANY CATEGORY OF PERSONAL DATA.]
- **Breaches:** Novera notifies the customer without undue delay after becoming aware of a personal data breach affecting its data. [NOTIFICATION CONTENT, CHANNEL AND TARGET TIME; INCIDENT PROCEDURE NOT YET WRITTEN.]
- **Audits:** Novera makes available the information necessary to demonstrate compliance with this agreement and allows for audits. [COUNSEL TO DRAFT SCOPE, NOTICE AND COST.]

## 9. Deletion or return

- Raw agent replies are emptied automatically at the end of the retention period the customer chooses (30 to 365 days).
- Erasing a workspace deletes its data at once, leaving only a record that an erasure happened, without personal data.
- An owner or admin can download a complete workspace export (Settings → General), for return before deletion; the download link works once and for 15 minutes. [COUNSEL TO CONFIRM WHETHER THIS MEETS THE RETURN OBLIGATION, AND THE TIME LIMIT FOR DELETION AFTER TERMINATION.]
- Backups held by the database provider: [TO VERIFY RETENTION AND DELETION WITH SUPABASE].

## 10. International transfers

Some sub-processors in Annex 2 process data outside the European Economic Area. Draft position: such a transfer relies on the EU–US Data Privacy Framework where the recipient participates in it, or otherwise on standard contractual clauses with a transfer impact assessment. [THE MECHANISM FOR EACH PROVIDER IS NOT YET VERIFIED — COUNSEL TO CONFIRM, INCLUDING WHETHER A TRANSFER IMPACT ASSESSMENT IS NEEDED FOR GROQ.] Where a customer connects its own model key, the transfer to that provider follows the customer's own choice and agreement.

## Annex 1: technical and organisational measures

[COUNSEL AND FOUNDER TO COMPLETE. THE ITEMS BELOW ARE WHAT THE CODE DOES TODAY.]

- Model API keys and agent credentials encrypted with AES-256-GCM, bound to their workspace, decrypted only on the server.
- Row-level security in the database; every reference between tenant records checked to stay within one workspace.
- Evidence append-only, enforced by the database; reports sealed with a SHA-256 hash and chained to the previous report.
- API keys stored only as an HMAC; scopes chosen by their creator.
- Personal-data-shaped text redacted in Suite Builder sources, production failures and sealed reports.
- Outbound calls only to public addresses; private, loopback and metadata addresses refused.
- Role-based access in each workspace; an append-only audit trail of access changes.
- Retention passes that empty raw replies and erase support messages on schedule.
- Continuous integration (lint, types, tests, build, migration and secret checks) runs on every change; server errors are captured with secrets scrubbed, not yet sent to an external monitoring service.
- Not yet in place: an incident response procedure, a tested restore of the production database (a restore has been tested on a local copy only), and external error monitoring and alerting. [STATUS AT SIGNATURE.]

### Data-class ceilings for model providers

${dataClassAnnex()}

## Annex 2: sub-processors

The list on the Sub-processors page (register version ${REGISTER_VERSION}), as at the date of signature:

${PROVIDER_REGISTER.filter((p) => p.status !== "planned").map((p) => `- **${p.provider}** (${p.status === "core" ? "core" : "optional"}) — ${p.service}. Location: ${p.location}`).join("\n")}

The services the customer configures itself (its own model key, the agent under test, a read-back endpoint, webhook receivers) are not in this list; see section 1.

[ATTACH THE DATED LIST AT SIGNATURE.]`,
};
