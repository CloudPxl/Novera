---
title: Novera in plain words: what each part does
published: true
---
Novera tests an AI support agent the way a careful auditor would: it sends the agent a fixed set of realistic customer conversations, checks every answer against the rules the company wrote for it, and seals the result in a dated report that anyone can check was not changed afterwards. This page explains each part in plain words, and why you would use it. For where each part sits on screen, see [Finding your way around Novera](/docs/finding-your-way). For the words, see the [plain-words glossary](/docs/plain-glossary).

Novera produces testing evidence. It is not a certification, and it does not tell you whether a law applies to you or whether you meet it. See [What Novera is not](/docs/limitations).

## Connecting an agent

**What it is.** You tell Novera the web address your AI agent answers on, how to send it a message and where its reply comes back. Novera then talks to the agent exactly as a customer's chat window would. It does not change your agent and does not sit between your agent and your customers.

**Why you would use it.** It is the first step: nothing can be tested until Novera can reach the agent. You also confirm that you own the agent or are authorised to test it, and that confirmation is copied onto every report. If you have no agent address to hand, a sample agent lets you try everything first. See [Connecting your agent, step by step](/docs/connect-step-by-step).

## Production or test target

**What it is.** Every agent is treated as **production** (it serves real customers) until an owner or admin marks it a **test target**. Scenarios that attempt something irreversible, or that only make sense against test data, are never sent to a production agent; they show as not run.

**Why you would use it.** Point Novera at a staging copy of your agent and mark it a test target to run the full set safely.

## Policies

**What it is.** The policy is your written rules for the agent: when refunds are allowed, how identity is checked, what it must never say. Every answer is judged against it. Each time you save it, Novera keeps a new numbered version and never edits an old one.

**Why you would use it.** The policy is the yardstick. Because versions are kept, every report can say exactly which rules it measured against.

## Scenarios and suites

**What it is.** A **scenario** is one test: a message a customer might send, what the agent should do, and what would count as failing. Some are ordinary requests, some are deliberate tricks and attacks, and some are conversations over several turns. A **suite** is a numbered set of scenarios. A published suite version never changes, so two reports on the same version can be compared fairly.

Novera ships these built-in suites, listed under **Scenarios → Catalog**:

- **EU support agent conformity suite** (`eu-support`), the main one. Version 5 has 49 scenarios: identity checks, refunds and other actions, data-protection requests, disclosure that the agent is automated, prompt injection and more.
- **EU GDPR privacy support suite** (`eu-gdpr-support`), focused on personal-data requests.
- **E-commerce refunds and withdrawal suite** (`e-commerce-refund`).
- **Fintech support guardrails suite** (`fintech-kyc`), for financial-services support: no personal investment or tax advice, identity documents only through the proper channel, and similar limits.

The catalog also holds a short suite for a support agent that answers from documentation, and every earlier version of each suite.

**Languages.** Some scenarios of these suites can be sent in German, French or Romanian instead of English. You choose the language in the **Run evaluation** launcher in the top bar; the rest of the scenarios are sent in English, and the report says how many went in which language.

**Extensions.** You can run up to five of your own approved scenarios beside an official suite. The official scenarios stay exactly as shipped, and the report shows them apart from yours.

**Why you would use it.** A fixed, versioned suite is what makes a result comparable from one month to the next, and from one agent to another.

## Writing your own scenarios

**What it is.** You can draft scenarios from your policy, import them from a file or from another testing tool, build a suite with the **Suite Builder** (start from a measured baseline pack, add your own documents, approve what applies), or turn a real production mistake into a scenario under **Regressions**. Whatever the source, a scenario only runs after a named person approves it.

**Why you would use it.** The built-in suites cover common duties. Your own scenarios cover your own business. See [Writing and importing a suite](/docs/writing-a-suite), [The Suite Builder](/docs/suite-builder) and [Regressions from production](/docs/regressions-from-production).

## Runs

**What it is.** A **run** is one test: one agent, one policy version, one suite version, recorded before anything is sent. Novera sends the scenarios at a steady pace, at most one every quarter of a second, and records what comes back. If the agent cannot be reached three times in a row, the run stops and nothing is sealed: an outage is never reported as a result.

**Why you would use it.** A run is how evidence is made. Run again after every change to the agent, and compare.

## Graders and rules

**What it is.** Answers are judged in the cheapest way that is enough. First, fixed **rules** written into a scenario ("must not mention X", "must not use that tool"): a rule can fail an answer, never pass it. Then, if set up, a check of your own system (the read-back, below). Whatever is left goes to AI models called **graders**: normally two from different companies (on your own model key, the models you named for it); if they disagree, a third settles it; if even that fails, the scenario has no result.

**Why you would use it.** One AI model grading on its own was measured changing its mind on about a quarter of identical answers. Two independent graders make a verdict much steadier, and the report says how every verdict was reached.

## Read-back: checking what the agent claims it did

**What it is.** An optional, read-only connection to your own system, such as an order lookup. When a scenario expects the agent to do something (issue a refund, open a ticket), Novera looks in your system afterwards to see whether it really happened. It can only read, never change anything. Set it up on the agent's page, under **Connection → Verifying what the agent does**.

**Why you would use it.** Without it, an agent that says "done" without doing anything could look fine. With it, a claimed refund that never happened is a failure, and a confirmed one is real evidence. Without a read-back, such scenarios are reported as unable to verify, never as passed.

## Reports and the seal

**What it is.** When a run finishes with every scenario recorded, Novera seals a report: a private link to a document with the results, the findings, and the scope and limitations. Sealing means calculating a digital fingerprint (SHA-256) of the content. Anyone can check that fingerprint at [the seal check](/verify). Reports for the same agent are chained, each naming the one before.

**Why you would use it.** It is the thing you hand to a client, a manager or an auditor. They can check it was not altered, without taking anyone's word for it. See [Reading a report](/docs/reading-a-report).

**Sharing.** Copy the link, print it to PDF, or download it as Markdown, CSV, JSON (the copy that can be verified) or JUnit (for software pipelines). A link expires after 30 days and can be withdrawn at any time. A report can also be embedded as a small badge on a web page.

## Your own finding beside a verdict

**What it is.** If you disagree with a verdict, record your own finding with a reason. It sits beside the automated verdict and never changes it. To show it to a client, issue a new report that carries the original unchanged and adds your review, clearly labelled as coming from the tested company.

**Why you would use it.** Graders can be wrong, and your reasoning belongs in the record. But a report you could quietly re-grade would be worth nothing to an auditor.

## Finding out why something failed

**What it is.** On a failed scenario, **Why did this fail?** asks a model to read the stored evidence and propose a change to your policy, quoting the exact passage. It is only a proposal: nothing changes until a person approves it, and approving creates a new policy version.

**Why you would use it.** It turns a failure into a concrete next step, while a person stays in charge of the rules.

## Checking one scenario again

**What it is.** **Try this scenario alone** sends one failed or no-result scenario to the agent again, against the newest policy version, and grades it the same way. The result is labelled as a single-scenario check: it is never sealed, never counted in a score or report, and does not use one of the trial's runs.

**Why you would use it.** To see quickly whether a fix worked, before running the whole suite again.

## Comparing runs

**What it is.** Two runs of the same suite side by side: what was fixed, what newly broke, what still fails, and what lost its result. Novera keeps a fingerprint of every answer, so it can tell an agent that changed from graders that changed their minds on an identical answer, and never counts the second as your agent getting better or worse.

**Why you would use it.** After every change to the agent, the comparison tells you whether you fixed one thing and broke another.

## Review

**What it is.** One queue of what needs a person across the recent runs: failures, scenarios with no verdict, newly broken scenarios, actions that could not be checked, and drafts waiting for approval.

**Why you would use it.** It is where a reviewer starts the day.

## Schedules

**What it is.** A suite run automatically every day or every week, at a fixed hour in UTC, against one agent. Each scheduled run is an ordinary run, with its own report and a comparison with the previous one. A schedule pauses, with the reason, when a run cannot start.

**Why you would use it.** The agent's underlying model, prompt or knowledge base can change without anyone pressing a button. A schedule catches the difference. It is a regular re-test, not round-the-clock monitoring. See [Scheduled runs](/docs/scheduled-runs).

## Release gate in your software pipeline (CI)

**What it is.** A ready-made GitHub Actions workflow, offered on each agent's page, that runs a pinned suite on every change to your code and fails the check when a scenario fails or the evidence is incomplete. Made a required check, it blocks the change from being merged.

**Why you would use it.** Your developers find out before a release, not after a customer does. See [Integration with GitHub Actions](/docs/integration-github-actions) and [Reports in CI](/docs/cli-and-ci).

## Webhooks

**What it is.** Novera can notify another system when a run finishes or stops, or when a schedule pauses. The message carries counts and a link, never the agent's answers, your policy or any key.

**Why you would use it.** To post results into a ticketing tool or a chat channel without anyone checking Novera.

## The API and MCP

**What it is.** A workspace API key lets a script, a pipeline or an AI assistant (through MCP, the protocol assistants such as Claude use to reach other tools) read your agents, runs and verdicts. A key reads only, unless whoever created it allowed more. No key can approve anything, change a policy, or publish or withdraw a report.

**Why you would use it.** To connect Novera to the tools your team already works in. See [The Novera API](/docs/api).

## Ask Novera

**What it is.** An assistant behind a button in the bottom-right corner of every signed-in page. It explains how Novera works from these documentation pages, citing the page it used, reports your own runs from their stored counts, and can take you to the right page. It cannot change anything, and it never declares that you may test an agent. See [The Ask Novera assistant](/docs/ask-novera).

## Members and roles

**What it is.** A workspace can have several members, each with one role: **owner** (everything), **admin** (everything except retention and erasing the workspace), **operator** (connects agents, writes policy, runs suites; cannot approve), **reviewer** (reads evidence, approves or rejects drafts and proposals, records findings) and **auditor** (reads everything, including the audit log; changes nothing). Changes to who may do what are kept in an audit log.

**Why you would use it.** The person who writes a scenario is not the person who approves it, and an auditor can look without being able to touch.

## Your own model key

**What it is.** Grading uses AI models. On the trial, Novera pays for them. A workspace can instead connect its own model account (often called BYOK, "bring your own key"), and then all of its grading runs on that key, never on Novera's. Every report states who paid for its grading.

**Why you would use it.** To keep grading under your own model account and contract. See [The trial, plans, and using your own model key](/docs/the-trial-and-your-own-key).

## Data and privacy

Novera's database is in Frankfurt, in the EU. Agents' raw answers are kept for a retention period you choose (30 to 365 days, 180 by default), then emptied, keeping the verdict and a fingerprint of the answer. An owner or admin can export the whole workspace. See [Data and privacy](/docs/data-and-privacy).
