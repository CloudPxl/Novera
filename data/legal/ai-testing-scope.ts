/**
 * AI Testing Scope and Limitations Notice, with Novera's own AI transparency notice —
 * DRAFT for legal review.
 *
 * Sources consulted (read 2026-10-09): AI Act (Reg. 2024/1689) Article 3(3)–(4), Article
 * 50(1), (4) and (5), Article 113 (Article 50 applies from 2 August 2026); Regulation
 * (EU) 2026/1744 (Digital Omnibus on AI, the Article 50(2) transition); the Commission's
 * Article 50 FAQ. Whether Novera's assistant and drafting are within Article 50, and in
 * which role, is for counsel; this text informs people either way and claims nothing.
 *
 * The limitations restate data/docs/limitations.md, docs/OBLIGATIONS.md and CLAUDE.md
 * (errored, disputed and unexecuted cases; the assurance gap; fixtures; read-back).
 *
 * Version 0.3 (2026-10-16) states the founder's memo's draft position on roles (Novera provides
 * its own platform; it is neither provider nor deployer of the agent it tests) and the labels the
 * product now shows: Ask Novera says it is an AI assistant and labels each answer, and drafted
 * scenarios, suggested replies and diagnoses say a language model drafted them.
 */
import type { LegalDocument } from "./types.ts";
import { REPORT_NOTICE_PARAGRAPHS, REPORT_NOTICE_TITLE } from "../../src/lib/legal/notices.ts";

export const aiTestingScope: LegalDocument = {
  slug: "ai-testing-scope",
  title: "AI Testing Scope and Limitations",
  summary: "What a Novera report does and does not show, and where Novera itself uses AI.",
  status: "draft",
  version: "0.3 draft",
  lastReviewed: "2026-10-16",
  sources: ["ai-act", "ai-omnibus", "ai-art50-faq", "gdpr"],
  body: `This notice forms part of the Terms of Service and is meant to be read by anyone who relies on a Novera report. It is a draft for review by counsel.

## What a report covers

- **Declared scenarios only.** A report covers the scenarios listed in it, from the suite version named in it. It does not cover interactions that were not tested, and it does not predict how the agent will behave later or on other inputs.
- **One configuration, one date.** The evidence is as of the date, suite version, policy version, agent address and grading models recorded in the report. A change to the agent's prompt, model or tools can change its behaviour without anything in the report changing.
- **Authorised targets.** Each run stores a member's declaration that they own or are authorised to test the agent. Novera does not verify that declaration independently.
- **Obligation codes organise evidence.** They group scenarios under duties many organisations have to account for. They do not decide which laws apply to an organisation, and Novera does not give legal advice.

## ${REPORT_NOTICE_TITLE}

Every report, every export of it and the page where its link is shared carry this notice:

${REPORT_NOTICE_PARAGRAPHS.join("\n\n")}

Novera does not call a report a "conformity assessment report", and does not describe itself as an assessor, auditor, certification provider or notified body. Where a report groups evidence under obligation codes, that grouping organises evidence; it is not a determination of which obligations apply.

## How verdicts are reached, and how they can be wrong

- Deterministic checks run first. They can fail a scenario; they can never pass one.
- If the agent has a read-back, a claimed action is confirmed or contradicted against the customer's own system.
- What remains is graded by language models. On Novera's keys, two models from different vendors grade each case and a third settles a disagreement. Model grading can be wrong, and each report says how each verdict was corroborated: by two vendors, within one vendor, or not at all.

## What a report counts separately

None of the following is ever counted as a pass:

- **Errored:** the scenario could not be completed, for example because the agent did not answer.
- **Disputed:** the grading models disagreed and a third could not settle it.
- **Unexecuted:** the scenario never ran.
- **Unavailable evidence:** a read-back could not confirm or contradict a claimed action.

A report states its assurance gap, the share of the suite that produced no verdict. A grade is withheld when everything ran but the evidence does not support one, and a report is marked incomplete when scenarios never ran.

## Test fixtures are not real actions

Novera includes a scripted test agent and test data. Anything produced by them is labelled as test data and is never presented as a real external action. A scenario that plays a simulated customer with a model is labelled simulated, names the model, and the report says no real customer took part.

## Novera's role under the AI Act

Draft position: Novera is the provider of its own testing platform, including the features below that use language models. It is neither the provider nor the deployer of an agent a customer tests with it; the customer remains whatever it is for that agent (Terms, section 7). [COUNSEL TO CONFIRM UNDER ARTICLE 3.]

## Where Novera itself uses AI

People should know when they are reading text a model wrote.

- **Ask Novera,** the assistant in the signed-in product, answers with a language model. Its panel says, before anything is asked, that it is an AI assistant whose answers are generated by a language model and can be wrong, and each answer is labelled as generated by a language model. An answer built from the workspace's figures because no model reply could be shown says so instead. It cannot change settings, policies or verdicts, and it cannot declare authorisation to test.
- **Support replies** to the public support form are drafted by a language model from Novera's documentation, labelled with the model that drafted them, and a person reads, edits if needed, and approves each one before it is sent. Questions about money, personal data, contracts or security are not drafted by a model.
- **Drafted scenarios and diagnoses** are labelled "drafted by a language model", with the model's name where it was recorded. Each is a proposal that a person must approve before it changes anything.
- **Grading** uses language models; every report names each model that graded and in which role.

[DRAFT POSITION: ARTICLE 50(1) APPLIES TO ASK NOVERA AND ARTICLE 50(2) TO MODEL-DRAFTED TEXT. COUNSEL TO CONFIRM, INCLUDING WHETHER VISIBLE LABELS ARE ENOUGH OR ARTICLE 50(2) ALSO NEEDS MACHINE-READABLE MARKING, AND WHETHER THE WORDING AND PLACEMENT ARE ADEQUATE. ARTICLE 50 APPLIES FROM 2 AUGUST 2026.]`,
};
