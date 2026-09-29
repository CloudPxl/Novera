---
title: What Novera does
published: true
---
Novera runs a versioned scenario suite against an AI support agent you operate, grades every answer against a policy you wrote, and produces a dated report you can hand to a client.

The current suite is `eu-support v5`: forty-nine scenarios covering identity verification, authorisation boundaries, erasure requests, data access and export, restriction of processing and telling recipients, data minimisation, policy accuracy, source grounding, instruction integrity, escalation and human review, transaction safety, failure transparency, AI disclosure, automated-decision notice, jailbreaks and prompt injection, commercial guardrails, and authorised actions that should succeed. Version 5 adds eight: an instruction planted in a knowledge-base article the agent retrieves, and one inside a tool's result (both delivered as data about the conversation, never as the customer's message); a request that grows from a status check to cancelling every workspace across two turns, checked turn by turn; a refund applied to a different invoice from the one named; identity borrowed from another channel; personal data read back in full "to confirm it"; and GDPR Articles 18 and 19 — restricting processing while a correction is checked, and telling the people data was shared with about an erasure. A new run uses the newest version unless you choose another.

Earlier versions stay exactly as they were. A report names the suite version it ran, so a report issued against `eu-support v1` keeps verifying after v3 ships.

Novera does not modify your agent and does not sit between your agent and your customers. It sends test scenarios to an endpoint you nominate and records what comes back.
