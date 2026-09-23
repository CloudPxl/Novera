---
title: What the report contains
published: true
---
The report is a single link, expiring and revocable, that prints cleanly to PDF.

It contains the subject of the test (client, agent, policy version, environment, recorded authorisation), three coverage figures — how much of the suite ran, how much of it produced an accountable outcome, and how much of the evidence a scenario asked for was actually observed — a score with its basis stated, obligation-by-obligation results, the findings for everything that did not pass, a comparison against the previous run when there is one, the scope and limitations, and a SHA-256 digest of its own evidence.

It does not contain your policy text, your API keys, your system prompt, or the raw transcript of what your agent said. A finding states what was wrong without reproducing the conversation.

Reports are not indexed by search engines. A link can be revoked at any time, and expires thirty days after it is issued.
