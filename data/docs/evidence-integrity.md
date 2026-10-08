---
title: Why the report can be trusted
published: true
---
Results, policy versions, probe receipts and reports are append-only in the database itself, enforced by triggers rather than by application code. A failing case cannot be edited into a passing one or deleted from a run — not by you, not by Novera, and not with the administrative key.

A policy version is immutable. Editing a policy creates a new version, so a report always names exactly the text the agent was tested against.

Errored and unexecuted cases are counted separately and never as passes. The score states the basis it was calculated on rather than leaving it implied.

A run declares its inputs before it executes: the suite version and the case ids in order, the policy version, the agent, the pass mark, which models will grade, the runner version, and a digest of the grading rubric itself. The database refuses to let that record change afterwards. A digest over the finished document proves it was not edited; the declaration proves the inputs were not chosen once the answers were known.

The declaration also records what was tested: where Novera sent its requests, and a digest of how it sent them — the endpoint, the request template and the response paths, never a credential or a header's value. You can add what you know and Novera cannot see: the agent release and the knowledge-base revision you are testing. The report lists each item with where it came from — recorded by Novera, declared by you and not verified by Novera, or not supplied — so no one reads your statement as Novera's observation.

Each report carries a SHA-256 digest computed over its own evidence. If any figure or finding were altered, the digest would no longer match the stored run. Reports for the same agent chain to the one before them.

Where a scenario expects an action rather than words, the agent's account of it is not accepted as proof. Either recorded tool activity evidences it, or your own system is read back independently, or the pass is withheld and the report says which.

The one thing that can be changed about a report is its availability: it can be withdrawn, and it expires.
