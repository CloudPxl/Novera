---
title: Reading a report (for clients and managers)
published: true
---
This page is for the person who receives a Novera report: a manager, a support director, a legal adviser, a client. You do not need to know how AI models work to read one. Each section below follows the report from top to bottom and says what it means in plain words.

## What a report is, and what it is not

A Novera report records one test of one AI support agent. Novera sent the agent a fixed set of realistic customer conversations, called **scenarios**, recorded what came back, and judged each answer against the rules the company wrote for its agent. The report is dated, and it is sealed, which means nobody can change it afterwards without that being detectable.

It is testing evidence for the scenarios listed in it, on the date shown. It is not a certification, a conformity assessment, a legal opinion or a promise about how the agent will behave tomorrow. Every report says so near the top, and again in full under **Scope and limitations**. See [What Novera is not](/docs/limitations).

## The 60-second guide

Near the top of every report is a closed box, **How to read this report (60-second guide)**. Open it for a short summary with this report's own numbers: how many scenarios were sent, how many passed, failed or have no result, whether claimed actions were checked, and what the seal shows. When the report is printed, the same guide appears as a short legend on the first page.

## The cover

The top of the report names:

- **The client**, in large type, and Novera's standing notice: testing evidence, not certification.
- **Agent**: the name the company gave the AI agent that was tested.
- **Policy version**: which version of the company's written rules the answers were judged against. Every saved change to the rules gets a new number, so this tells you exactly which text applied.
- **Run date**, **Scenario suite** (which set of scenarios, and its version) and **Run reference** (an identifier you can quote back to whoever sent you the report).
- **Environment**: whether this was a real agent run by the company, or Novera's own scripted test agent.
- **Language**, only when some scenarios were sent in a language other than English.

A **Sealed** button shows the report's digital fingerprint and what it covers. If the report was made with Novera's own scripted test agent, a dashed **Test data** label appears above the title. Such a report says nothing about a real agent: it exists to show how Novera works.

## The grade and the numbers

Under **Coverage** you see a grade, five counts and, on most reports, three percentages.

The **counts** are **Passed**, **Failed**, **Errored** (ran, but produced no verdict), **Not run** and the **Score**.

- **Passed** means the agent's answer did what the scenario expected.
- **Failed** means it did not: it broke a rule written into the scenario, the graders found it fell short, or the company's own system showed that something the agent claimed to have done did not happen.
- **Errored** and **Not run** are scenarios with no result. They are never counted as passes, and they are left out of the score.

The **score** is the share of scenarios with a verdict that passed. The **grade** turns it into a letter: A from 90%, B from 80%, C from 70%, F below that. The report also says whether the score met the **pass mark** set for this test.

Sometimes there is no letter, and a word stands in its place, drawn as large as a letter would be:

- **WITHHELD**: every scenario ran, but some produced no verdict, for example because the agent did not answer, the graders could not agree, or a claimed action could not be confirmed. A letter calculated only over the scenarios that happened to work would claim more than the test showed.
- **INCOMPLETE**: some scenarios never ran, because the test did not finish or because Novera's own rules held them back (see "What the report cannot tell you" below). The grade would describe only part of the test.

Reports sealed in an early format used INCOMPLETE for both situations, so on an older report read the sentence beside the grade to see which one applied.

The three percentages answer a different question from the score: how much of the test actually happened.

- **Executed**: the share of the scenarios that ran at all.
- **Reasoned**: the share of the checks those scenarios carry that ended with a clear, stated reason.
- **Evidenced**: of the scenarios that asked for proof beyond the agent's own words, the share that got it. "None required" means no scenario asked for such proof.

A line under them may give the **assurance gap**: the share of the test that produced no verdict. That part is neither a pass nor a failure. It is the part the report cannot speak to.

## What was tested, and the obligations

**What was tested** groups the scenarios by area (identity checks, refunds, data requests and so on), with how many in each passed. A failed critical scenario is called out by name, because an area can look healthy on percentages while the one scenario that mattered failed.

**Obligation coverage** lists the duties the scenarios relate to, such as erasure requests or disclosure that the agent is automated:

- **Met**: every scenario for that duty passed.
- **Issues found**: at least one failed or produced no result.
- **Not covered**: nothing gradable ran. That is never the same as satisfied.

These labels group the evidence. They do not decide which laws apply to your organisation; that is a question for your own legal adviser.

## A finding

Every scenario that did not pass appears under **Findings**, most serious first. Each one shows:

- its **severity** (critical, high, medium or low: how serious a failure there would be);
- the **scenario number** and the duty it relates to;
- **Expected**: what the agent should have done, in the words of the scenario;
- **Observed**: what was wrong with what it did. For a scenario with no result, this line reads **Why there is no result** instead, and says where it stopped.

The report describes a failure without reproducing the conversation. It does not contain the customer's message word for word, the agent's full answer, the company's rules or any keys. The people in the tested company's Novera account can open the full conversation, the agent's reply and each grader's reasoning on the run's own page, for as long as their retention setting keeps it. If you need to see a conversation, ask them.

## Claimed actions, checked

Some scenarios expect the agent to **do** something, such as issue a refund or open a ticket. An agent saying "I've refunded your order" is a sentence, not a refund. So Novera does not accept the agent's word for it.

If the company gave Novera a read-only connection to its own system (called a **read-back**), Novera looked there after the conversation. There are three outcomes:

- **Confirmed**: the company's system shows the action happened. The report counts these.
- **Contradicted**: the agent said it acted, and the company's system does not show it. The scenario fails on that basis alone, without asking any AI grader. This is the strongest finding a report can contain.
- **Could not check**: the connection did not answer in a usable way, or none was set up for that kind of action. The scenario has no result, never a pass. A "not found" answer is read as could not check too, because a missing record and a wrong address look the same — unless the company told Novera that its system answers "not found" only for records that do not exist. Then "not found" means the agent claimed to act on a record that is not there, and the scenario is contradicted.

Only scenarios that expect an action are checked this way, and only where the company set up the connection. If none was set up, scenarios that expect an action are reported as unable to verify. That is a limit of the test setup, not a finding against the agent.

## Who judged the answers

Most answers are judged by AI models, called **graders**. Novera does not rely on one: each answer goes to two graders made by different companies, and if they disagree, a third settles it. If even that cannot settle it, the scenario has no result. Novera never picks a side.

Some scenarios carry fixed rules, such as "must not say this" or "must not use that tool". A rule can fail a scenario without asking any grader. It can never pass one, because not doing the wrong thing is not the same as doing the right thing.

Under **Scope and limitations**, the report says exactly how its verdicts were reached: how many the first two graders agreed on, how many a third settled, how many rest on one grader only, how many were settled by a rule, and whether the graders came from different companies or one. A company that grades with its own model account may use models from one company only, and the report says so. See [How a run works](/docs/how-a-run-works).

## Comparison with the previous run

When there was an earlier test of the same agent, **Compared with the previous run** lists what was **Fixed**, what is **Still failing** and what is **Newly failing**. A scenario that has flipped between pass and fail across earlier tests is named separately, because its movement on its own does not show that a change caused it.

## The seal, and how to check it

At the bottom of the report is a long string of letters and numbers: the **SHA-256 digest**. Think of it as the document's fingerprint. It is calculated from the report's content. If anyone changed a single character after sealing, the fingerprint would no longer match.

To check a report yourself:

1. Open [the seal check](/verify).
2. Paste the fingerprint from the report, or download the report's **JSON** file (a button at the top of the report) and drop it onto the page. The file is checked in your browser; only its fingerprint is sent.
3. The check says whether Novera sealed a report with that fingerprint, and whether the copy you hold matches it.

A match shows the document was not changed after it was sealed. It does not show that the agent behaves well, that the company meets any law, or that the test covered everything that matters.

The footer may also show a second fingerprint: the test's inputs (the scenarios, the rules version, the graders and the pass mark), recorded before the test ran. It shows those were not chosen after the answers were known. A report can also name the fingerprint of the previous report for the same agent, so a series of reports forms a chain in which a missing or replaced report would show. See [Why the report can be trusted](/docs/evidence-integrity).

## Test data

Two kinds of content are labelled as test data:

- A report made with Novera's own scripted test agent carries a **Test data** label next to the title. Its failures are planted on purpose.
- Some scenarios continue a conversation with an AI model playing the customer. When a report includes one, its limitations say that no real customer took part.

Neither is ever presented as a real customer or a real agent.

## The link

A report link is private and is not indexed by search engines. It expires 30 days after it was issued, and the company can withdraw it at any time; after that, the link and every download stop working for everyone. The page shows the expiry date at the bottom. To keep a copy, use **Print or save as PDF**, or download the JSON file, which is the copy you can verify later.

## What to ask next

If someone sent you this report, these questions get you the most from it:

1. Which failed scenarios matter most to us, and what will change before the next test?
2. Why do the scenarios with no result have none, and what is being done about it?
3. Was a read-only connection to our own system set up, so that claimed actions were checked rather than taken on trust?
4. Was this the production agent or a test copy? Some scenarios are never sent to a production agent and show as not run.
5. Which version of our rules was used, and is it the one in force today?
6. When is the next test, and will it be compared with this one?

## What the report cannot tell you

- How the agent behaves in conversations that were not tested, or in the future.
- Whether a law applies to your organisation, or whether you meet it.
- Anything about scenarios that produced no result or never ran: that is exactly what the assurance gap measures.
- Whether a scenario Novera held back would have passed. Scenarios that attempt something irreversible are never sent to an agent marked as production, and appear as not run.

For the full list of what a report contains, see [What the report contains](/docs/what-the-report-contains). For the words used here, see the [plain-words glossary](/docs/plain-glossary).
