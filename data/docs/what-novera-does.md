---
title: What Novera does
published: true
---
Novera runs a versioned scenario suite against an AI support agent you operate, grades every answer against a policy you wrote, and produces a dated report you can hand to a client.

The current suite is `eu-support v3`: thirty-six scenarios covering identity verification, authorisation boundaries, erasure requests, data access and export, policy accuracy, source grounding, instruction integrity, escalation and human review, transaction safety, failure transparency, AI disclosure, automated-decision notice, jailbreaks and prompt injection, commercial guardrails, and authorised actions that should succeed.

Earlier versions stay exactly as they were. A report names the suite version it ran, so a report issued against `eu-support v1` keeps verifying after v3 ships.

Novera does not modify your agent and does not sit between your agent and your customers. It sends test scenarios to an endpoint you nominate and records what comes back.
