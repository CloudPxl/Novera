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
 */
import type { LegalDocument } from "./types.ts";

export const dpa: LegalDocument = {
  slug: "dpa",
  title: "Data Processing Agreement",
  summary: "The terms for personal data Novera processes on a customer's behalf. A skeleton for counsel, not a final agreement.",
  status: "draft",
  version: "0.1 draft",
  lastReviewed: "2026-10-09",
  sources: ["gdpr", "edpb-07-2020", "edpb-opinion-22-2024", "edpb-dpia"],
  body: `**This draft is not final and is not sufficient on its own.** It records what Novera's service does with personal data, arranged under the headings a processing agreement needs. It must be completed and reviewed by counsel, and may be replaced by standard contractual clauses or by the customer's own form.

## 1. Parties and roles

- Customer: [CUSTOMER LEGAL NAME AND ADDRESS], acting as [CONTROLLER OR PROCESSOR — COUNSEL TO CONFIRM; AN AGENCY TESTING A CLIENT'S AGENT MAY ITSELF BE A PROCESSOR].
- Novera: [LEGAL ENTITY NAME], [REGISTERED ADDRESS], acting as [PROCESSOR OR SUB-PROCESSOR — COUNSEL TO CONFIRM].

[LAWYER REVIEW REQUIRED: THE ROLE ALLOCATION, INCLUDING FOR THE AUDIT TRAIL AND RUN ATTESTATIONS, WHICH THE PRIVACY NOTICE ALSO LEAVES OPEN.]

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

The customer gives general authorisation for the sub-processors in Annex 2. Novera will notify the customer of an intended addition or replacement [NOTICE PERIOD] before it takes effect, by [NOTICE METHOD], and the customer may object on reasonable data-protection grounds. [COUNSEL TO DRAFT THE CONSEQUENCE OF AN OBJECTION.] Novera imposes data-protection obligations on each sub-processor by contract and remains responsible for it. [TO VERIFY: EACH PROVIDER'S OWN DATA PROCESSING TERMS, ACCEPTED OR SIGNED.]

## 8. Assistance

- **Data subject requests:** the product lets the customer find, export and erase data in its workspace; Novera passes on any request it receives and helps where the product cannot. [RESPONSE TIMES.]
- **Security, impact assessments and prior consultation:** Novera provides the information in Annex 1 and on the Security and data flow page, and answers reasonable questions. [COUNSEL TO CONFIRM WHETHER NOVERA'S OWN PROCESSING NEEDS A DATA PROTECTION IMPACT ASSESSMENT.]
- **Breaches:** Novera notifies the customer without undue delay after becoming aware of a personal data breach affecting its data. [NOTIFICATION CONTENT, CHANNEL AND TARGET TIME; INCIDENT PROCEDURE NOT YET WRITTEN.]
- **Audits:** Novera makes available the information necessary to demonstrate compliance with this agreement and allows for audits. [COUNSEL TO DRAFT SCOPE, NOTICE AND COST.]

## 9. Deletion or return

- Raw agent replies are emptied automatically at the end of the retention period the customer chooses (30 to 365 days).
- Erasing a workspace deletes its data at once, leaving only a record that an erasure happened, without personal data.
- A complete workspace export, for return before deletion, is not yet available. [COUNSEL TO CONFIRM WHETHER REPORT EXPORTS SUFFICE IN THE MEANTIME, AND THE TIME LIMIT FOR DELETION AFTER TERMINATION.]
- Backups held by the database provider: [TO VERIFY RETENTION AND DELETION WITH SUPABASE].

## 10. International transfers

Some sub-processors in Annex 2 process data outside the European Economic Area. [TRANSFER MECHANISM FOR EACH — FOR EXAMPLE AN ADEQUACY DECISION OR STANDARD CONTRACTUAL CLAUSES — AND ANY TRANSFER IMPACT ASSESSMENT — COUNSEL TO CONFIRM.] Where a customer connects its own model key, the transfer to that provider follows the customer's own choice and agreement.

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
- Not yet in place: an incident response procedure, a tested backup restore, error monitoring, and continuous integration. [STATUS AT SIGNATURE.]

## Annex 2: sub-processors

The list on the Sub-processors page, as at the date of signature. [ATTACH THE DATED LIST.]`,
};
