---
title: Why the report can be trusted
published: true
---
Results, policy versions, probe receipts and reports are append-only in the database itself, enforced by triggers rather than by application code. A failing case cannot be edited into a passing one or deleted from a run — not by you, not by Novera, and not with the administrative key.

A policy version is immutable. Editing a policy creates a new version, so a report always names exactly the text the agent was tested against.

Errored and unexecuted cases are counted separately and never as passes. The score states the basis it was calculated on rather than leaving it implied.

Each report carries a SHA-256 digest computed over its own evidence. If any figure or finding were altered, the digest would no longer match the stored run.

The one thing that can be changed about a report is its availability: it can be revoked, and it expires.
