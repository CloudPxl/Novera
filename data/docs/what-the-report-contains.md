---
title: What the report contains
published: true
---
The report is a single link, expiring and revocable, that prints cleanly to PDF.

It contains the subject of the test (client, agent, policy version, environment, recorded authorisation), three coverage figures — how much of the suite ran, how much of it produced an accountable outcome, and how much of the evidence a scenario asked for was actually observed — a score with its basis stated, obligation-by-obligation results, the findings for everything that did not pass, a comparison against the previous run when there is one, the scope and limitations, and a SHA-256 digest of its own evidence.

It does not contain your policy text, your API keys, your system prompt, or the raw transcript of what your agent said. A finding states what was wrong without reproducing the conversation.

Reports are not indexed by search engines. A link expires thirty days after it is issued, and you can withdraw it at any time from the run page: the link and every download stop working at once, for everyone, and the withdrawal records who made it. A withdrawn report cannot be reopened; a new run gives a new report.

Before you send one, the run page says whether it is ready: **Ready to share**; **Review before sharing** (a pass rests on one model's verdict, a review was recorded after it was sealed, or no authorisation to test was recorded); **Incomplete** or **Grade withheld**, as the report itself says; **Blocked** if the document does not hold together; **Withdrawn** or **Expired**. Each check behind it is listed. A report that shows failures can be ready to share — it is the evidence your client is owed — and wanting to share a report never makes it more ready than its evidence.
