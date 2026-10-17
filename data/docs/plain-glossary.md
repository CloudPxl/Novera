---
title: Plain-words glossary
published: true
---
Every word you are likely to meet in Novera or in a Novera report, explained without jargon. The same words carry a small `?` on screen that explains them in place. For the bigger picture, see [Novera in plain words](/docs/novera-in-plain-words) and [Reading a report](/docs/reading-a-report).

## What is tested

- **Agent**: the AI support assistant being tested, reached at a web address the company gives Novera.
- **Policy**: the company's written rules for its agent, such as when refunds are allowed and how identity is checked. Every answer is judged against it.
- **Policy version**: each saved change to the policy becomes the next numbered version, and an old version is never edited. A test is judged against the version in force when it started, and its report names it.
- **Scenario**: one test. A message a customer might send (sometimes a whole conversation), what the agent should do, and what would count as failing. Some are ordinary requests; some are deliberate tricks and attacks.
- **Suite**: a numbered set of scenarios, such as "EU support agent conformity suite, version 5". A published version never changes, so two tests on the same version can be compared.
- **Extension**: an official Novera suite, unchanged, with up to five of the company's own approved scenarios run beside it. The report shows the two parts separately.
- **Locale**: the language scenarios are sent in. Some scenarios of the built-in suites can be sent in German, French or Romanian; the rest stay in English, and the report says how many went in which language.
- **Severity**: how serious a failure of a scenario would be: critical, high, medium or low. It decides what to read first; it does not change the score.
- **Production** and **test target**: an agent is treated as production (serving real customers) until an owner or admin marks it a test target. Scenarios that attempt something irreversible, or only make sense against test data, are never sent to a production agent.
- **Attestation**: the confirmation, ticked when the agent is connected, that the person owns the agent or is authorised to test it. It is recorded and copied onto every run and report.

## Running a test

- **Run**: one test of one agent, with one policy version and one suite version, all recorded before anything is sent.
- **Inputs declared before the run**: the record of what a run will test (the scenarios, the policy version, the graders, the pass mark), frozen before the first message is sent. It shows the inputs were not chosen after the answers were known.
- **Agent unreachable**: Novera could not get an answer: no connection, no reply in time, or the agent said it was busy or unavailable. That scenario is an error, never a failure of the agent. Three in a row stop the run, and nothing is sealed.
- **Single-scenario check**: one failed or no-result scenario sent to the agent again (**Try this scenario alone**), graded the same way. It is never sealed, never counted in a score or a report, and does not use a trial run.
- **Schedule**: a suite run automatically every day or week at a fixed hour (in UTC). Each scheduled run is an ordinary run with its own report.
- **Receipt**: the answer to the one harmless message Novera sends when an agent is connected or its connection is changed. It shows you are testing the agent you think you are.

## Judging the answers

- **Grader**: an AI model that reads the agent's answer and decides whether it did what the scenario expected.
- **Rule**: a fixed check written into a scenario, such as "must not say X" or "must not use that tool". A rule can fail an answer without asking any grader. It can never pass one.
- **Verdict**: the decision on one scenario: passed or failed.
- **Corroborated**: a verdict a second grader agreed with. Novera asks two graders from different companies; if they disagree, a third settles it. The report says how many verdicts were corroborated by a different company, how many within one company only, and how many rest on one grader.
- **Disputed** (or **unresolved**): the graders disagreed and a third could not settle it. The scenario has no result; Novera never picks a side.
- **BYOK** ("bring your own key"): a workspace that connects its own account with an AI model provider. All of its grading then runs on that account, never on Novera's, and every report says who paid for the grading. If its models all come from one company, verdicts are reported as corroborated within one vendor.

## Results

- **Passed**: the agent's answer did what the scenario expected.
- **Failed**: it did not. It broke a rule, the graders found it fell short, or the company's own system contradicted an action the agent claimed.
- **Error**: the scenario ran but produced no verdict, for example because the agent did not answer, the graders could not agree, or a claimed action could not be confirmed. Shown as **Errored** in a report's counts.
- **Not run**: the scenario never reached the agent, because the run stopped early or because Novera's own rules held it back.
- **No result**: errors and not-run scenarios together. Never counted as a pass, always counted on their own.
- **Score**: the share of scenarios with a verdict that passed. Scenarios with no result are left out of it and counted separately.
- **Pass mark**: the score the company set as its bar for this test. The report says whether it was met.
- **Grade**: the score as a letter: A from 90%, B from 80%, C from 70%, F below that.
- **WITHHELD**: every scenario ran, but some have no verdict, so no letter is given. A letter over only the scenarios that worked would claim more than the test showed. Fixing what made the evidence unusable is the remedy, not just running again.
- **INCOMPLETE**: some scenarios never ran, so no letter is given. Running the suite again, or changing what held them back, is the remedy. Reports sealed in an early format used INCOMPLETE for both situations.
- **Coverage**: three figures for how much of the test actually happened: how much of the suite ran (**Executed**), how much of what ran ended with a clear reason (**Reasoned**), and how much of the proof the scenarios asked for was found (**Evidenced**). A figure is left empty rather than shown as 0% or 100% when there is nothing to work it out from.
- **Assurance gap**: the share of the suite that produced no verdict. It is neither a pass nor a failure: it is the part the report cannot speak to.
- **Finding**: on a report, a scenario that did not pass, with what was expected and what was observed. In the app, a person can also record their own finding beside a verdict, with a reason; it never changes the verdict.

## Checking claimed actions

- **Claimed action**: something the agent says it has done, such as a refund or a ticket. Saying it is not proof of it.
- **Read-back**: an optional, read-only connection to the company's own system. After a scenario that expects an action, Novera looks there to see whether it happened. It can only read, never change anything.
- **Confirmed**: the company's system shows the claimed action happened.
- **Contradicted**: the agent said it acted, and the company's system does not show it. The scenario fails on that alone, without asking a grader. It is the strongest finding a report makes.
- **Evidence gap** (**unable to verify**): the agent claimed an action and nothing independent of the agent could confirm it, because no read-back is set up, the read-back could not be reached, or no tool activity was recorded. The scenario has no result, never a pass. It is a limit of the test setup, not a finding against the agent.

## The report and its seal

- **Report**: the dated document a finished run produces, at a private link that expires after 30 days and can be withdrawn. It is testing evidence for the scenarios listed, not a certification.
- **Seal**: the moment the report's content is fixed and its fingerprint calculated. After it, nothing in the report can change without the fingerprint showing it.
- **SHA-256**: the method used to calculate the fingerprint (also called a digest or hash): a 64-character string worked out from the content. Change one character and the string changes completely. Anyone can check it at [the seal check](/verify).
- **Chain to the previous report**: each report names the fingerprint of the one before it for the same agent, so a missing or replaced report would show.
- **Ready to share**: the run page's assessment that a sealed report's evidence supports handing it on. Others are **Review before sharing**, **Incomplete**, **Grade withheld**, **Blocked**, **Withdrawn** and **Expired**. Wanting to share a report never makes it more ready.
- **Withdrawn**: a report whose link the company stopped. The link and every download stop working at once, for everyone, and it cannot be reopened.
- **Test data**: content that is not a real customer or a real agent: a run against Novera's own scripted test agent, or a conversation in which an AI model played the customer. Always labelled as such.
- **Fixture**: Novera's own scripted test agent, with mistakes planted on purpose. Reports made with it carry a **Test data** label.

## Comparing over time

- **Baseline**: the earlier run a new run is compared with, usually the previous run of the same suite on the same agent. You can choose another.
- **Regression**: a scenario that passed before and fails now. **Regressions** in Novera is also the page where a mistake your agent made with a real customer becomes a new scenario.
- **Fixed**, **Newly failing**, **Still failing**: how each scenario moved between the baseline and the new run.
- **Graders moved**: a verdict changed although the agent's answer was exactly the same, word for word. Novera keeps a fingerprint of every answer, so it can tell, and it never counts this as the agent getting better or worse.
