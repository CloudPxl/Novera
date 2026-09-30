---
title: Regressions from production
published: true
---
When your agent gets something wrong with a real customer, that conversation is the best test case you have. The **Regressions** page turns it into a scenario, and every later run shows whether the same mistake came back.

## Recording a failure

Paste what the customer sent, and optionally what the agent replied. Then say, in one sentence, what should have happened — the scenario passes only if the agent does that. If you also say what went wrong, a reply that does it again fails the scenario for that reason. Choose the obligation it broke and its severity; the agent and the date are optional.

A pipeline can record one too, with an API key — see **The Novera API** for `POST /api/v1/production-failures`. It is stored exactly as the form stores it, and the Regressions page says which key sent it.

No model writes the scenario. It is built from what you recorded, so the expectation a regression test holds your agent to is yours, not a guess.

## What is stored, and what is not

Before anything is stored, Novera removes what it can recognise: email addresses, phone numbers, IBANs, payment card numbers, IP addresses and API keys, each replaced with a placeholder such as `[EMAIL_1]`. The form shows exactly what will be stored while you type.

Names and street addresses are not detected automatically. Remove them yourself before you record the failure — for example by replacing a name with `[NAME]`.

The original text is never stored. Novera keeps a SHA-256 hash of it, which proves which text a scenario came from without keeping the text. A recorded failure cannot be edited or deleted afterwards, except by erasing the whole workspace.

## From failure to regression test

A recorded failure becomes a draft scenario, numbered R01, R02 and so on, on the **Scenarios** page. Like every other draft, it cannot run until a person approves it by name, and it enters a suite only when you promote approved scenarios into a new suite version — usually one that extends the suite you already run.

The Regressions page follows each failure through that life:

- **Waiting for your review** — the draft has not been approved or rejected.
- **Approved, not yet in a suite** — promote it on the Scenarios page.
- **In a suite, not run yet** — run that suite.
- **Held** — it passed on the most recent completed run.
- **Still failing** — it has not passed on any run yet.
- **Came back** — it passed on an earlier run and failed on the most recent one.
- **No result on the last run** — the agent errored or the graders could not agree. That is never read as the defect being gone.

A regression carried into a later suite version still counts: Novera follows the same scenario id with the same message in any of your suites.
