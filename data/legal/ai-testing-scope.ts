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
 */
import type { LegalDocument } from "./types.ts";

export const aiTestingScope: LegalDocument = {
  slug: "ai-testing-scope",
  title: "AI Testing Scope and Limitations",
  summary: "What a Novera report does and does not show, and where Novera itself uses AI.",
  status: "draft",
  version: "0.1 draft",
  lastReviewed: "2026-10-09",
  sources: ["ai-act", "ai-omnibus", "ai-art50-faq", "gdpr"],
  body: `This notice forms part of the Terms of Service and is meant to be read by anyone who relies on a Novera report. It is a draft for review by counsel.

## What a report covers

- **Declared scenarios only.** A report covers the scenarios listed in it, from the suite version named in it. It does not cover interactions that were not tested, and it does not predict how the agent will behave later or on other inputs.
- **One configuration, one date.** The evidence is as of the date, suite version, policy version, agent address and grading models recorded in the report. A change to the agent's prompt, model or tools can change its behaviour without anything in the report changing.
- **Authorised targets.** Each run stores a member's declaration that they own or are authorised to test the agent. Novera does not verify that declaration independently.
- **Obligation codes organise evidence.** They group scenarios under duties many organisations have to account for. They do not decide which laws apply to an organisation, and Novera does not give legal advice.

## Evidence, not certification

A Novera report is not a certification, a conformity assessment under any law, or a statement that an organisation or its AI system complies with the GDPR, the AI Act or any other law. It is evidence that a defined suite was executed against a defined agent on a defined date, with the results kept as they occurred.

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

## Where Novera itself uses AI

People should know when they are reading text a model wrote.

- **Ask Novera,** the assistant in the signed-in product, answers with a language model. Its answers are generated and can be wrong. They appear only in the assistant's own panel, which states that questions go to language model providers. It cannot change settings, policies or verdicts, and it cannot declare authorisation to test.
- **Support replies** to the public support form are drafted by a language model from Novera's documentation, and a person reads, edits if needed, and approves each one before it is sent. Questions about money, personal data, contracts or security are not drafted by a model.
- **Grading, diagnosis and Suite Builder drafts** are produced with language models. A diagnosis or a drafted scenario is a proposal that a person must approve before it changes anything.

[COUNSEL TO CONFIRM WHETHER ARTICLE 50 OF THE AI ACT APPLIES TO ANY OF THESE, IN WHICH ROLE, AND WHETHER THE WORDING AND PLACEMENT OF THESE DISCLOSURES IN THE PRODUCT ARE ADEQUATE. ARTICLE 50 APPLIES FROM 2 AUGUST 2026.]`,
};
