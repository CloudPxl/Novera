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

**The scoped grade.** When at least half the suite produced a verdict, the report does not leave the box empty. It shows a **scoped grade**: the letter over the scenarios that were evaluated, never without its scope. "Scoped A, 44 of 49" means 44 scenarios reached a verdict and the letter describes those 44. Beside it is the **floor**: the pass rate if every scenario without a verdict had failed. If the floor still meets the pass mark, no outcome of the missing scenarios could have changed that; if only the scoped score does, the report says the evidence is incomplete until they have a verdict. The scenarios without a verdict are listed with the reason for each.

The grade for the whole suite is still withheld. A release gate, the API's `outcome` and the report's readiness read missing verdicts as missing evidence, exactly as before: the scoped grade tells a reader what was shown, not that the test is complete. On a report sealed before 12 November 2026 the scoped figures are computed from the counts sealed in it and shown beside the sealed text, which is unchanged. Below half the suite there is no scoped grade: that is a smaller test, not a scope.

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

## Which AI graders judged the answers

Most answers are judged by AI models, called **graders**. Novera does not rely on one: each answer goes to two graders made by different companies, and if they disagree, a third settles it. If even that cannot settle it, the scenario has no result. Novera never picks a side.

Some scenarios carry fixed rules, such as "must not say this" or "must not use that tool". A rule can fail a scenario without asking any grader. It can never pass one, because not doing the wrong thing is not the same as doing the right thing.

Under **Scope and limitations**, the report says exactly how its verdicts were reached: how many the first two graders agreed on, how many a third settled, how many rest on one grader only, how many were settled by a rule, and whether the graders came from different companies or one. A company that grades with its own model account may use models from one company only, and the report says so. See [How a run works](/docs/how-a-run-works).

## When a scenario has no result

A scenario without a verdict is never counted as a pass or a failure. On the run page each one carries a category, a plain sentence of what happened, and a **Full diagnosis**: what the stored evidence shows, the likely cause with how sure Novera is of it, what the evidence cannot tell, what Novera already did, and whether a retest is safe.

**Resolve no results.** A completed run with no-result scenarios offers one button. It retests every scenario whose diagnosis allows a retest without repeating anything the agent may have done — one at a time, through the single-scenario check, against the agent as it is now — and lists the one fix for each scenario where a retest would only repeat the same answer. When it finishes, each scenario says **Verdict reached: passed**, **Verdict reached: failed** or **No result again** with the reason. "Verdict reached: failed" means the retest worked and the agent's answer failed the scenario; it does not mean the retest broke. Each retest is stored beside its scenario as a check, never as part of the run: the report and its seal do not change.

**Complete the evidence.** When a retest reaches a verdict, the panel offers one button, **Complete the evidence and seal a new report**. It starts a completion: a new run of only those scenarios, against the same agent connection, policy version, suite and language. The retest itself is never what is sealed. A retest can be repeated as often as you like, so a report built from a chosen retest would let the tested party pick the sample; the completion sends each scenario once more, declared before it runs, and seals whatever that one execution produces. A scenario that needed a fix first can be completed once a retest shows the fix was made. One that may already have acted in your system is never sent again by Novera alone: check your system, retest it yourself, and once that retest reaches a verdict the panel offers the completion and says it sends the scenario once more.

**A scenario that expects an action.** Some scenarios expect your agent to do something, such as issue a refund, and pass only when Novera can read the result in your own system through the read-only endpoint on the agent's page. Without one, a reply the graders read as a pass is recorded as **Action not verified**, never as a pass: a refund the reply says was issued is not confirmed by anything, and an agent with no way to issue it would pass by saying so. Such a scenario can still fail. The agent's page says which scenarios these are before a run, and the report shows a scoped grade over the others. Its report carries every other verdict from the first run unchanged, computes the counts, grade and coverage from both runs' stored rows, names the first report by its digest, and says which scenarios were executed later and on which date. The first report stays sealed and still verifies; its page notes that a later report completes it. A completion is refused when the agent's connection, the policy or the grading funding changed since the first run — then rerun the suite for a report from one run.

- **Blocked by configuration**: a setting stopped the scenario, such as the agent's address, its response path, its credentials, or your own grading key. Fix the setting named, then retest. Retesting before that gives the same answer.
- **Not run**: Novera held the scenario back before sending it, because the agent's setup could not carry it (no conversation or metadata channel) or the agent is marked as production and the scenario could change something. The agent never received it.
- **Could not complete**: the scenario was sent and no complete reply arrived: a timeout, or the endpoint could not be reached. Whether the agent acted on it is not known.
- **Result unavailable**: the agent answered, and the answer could not be read as a reply: an error status, an empty reply, a reply that was not JSON, or one larger than Novera reads. When the agent's server answers HTTP 500 to a scenario that cannot act on anything twice, Novera sends it once more after 1.5 seconds; "twice" in the label means both attempts failed. That is still no result, not a pass or a failure: from outside, an input rejected by a firewall or filter in front of the agent and an agent that failed on the input look the same.
- **Inconclusive**: the evidence did not settle it. The AI graders disagreed and no grader from a third company could settle it, or the agent claimed an action that could not be checked.
- **Blocked on Novera's side**: the agent replied, and Novera's AI graders were rate-limited, slow or unreachable, or the run's time slice ended. Since 11 November 2026 a run keeps such a reply and grades it again, up to four times over about two minutes, before recording it this way, so on a newer run it means the graders stayed unavailable throughout. Nothing about your agent needs to change; retest the scenario. On your own model key, the same thing is that key's limit, and it is shown as configuration instead.
- **Withdrawn or expired**: a report that was withdrawn by its workspace, or whose link has expired. The evidence stays stored.

A diagnosis keeps what was observed apart from what it probably means. A cause read from a stored field Novera wrote itself is marked high confidence; one read from the error the agent's answer produced is medium; an error Novera never classified says "not determined" instead of guessing. No diagnosis says a person reviewed anything: verdicts come from AI graders and fixed rules, and a person's finding is recorded separately, beside the verdict.

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
