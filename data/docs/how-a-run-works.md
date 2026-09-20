---
title: How a run works
published: true
---
A run names three things at the moment it starts: the agent, the policy version, and the suite version. It executes against those, not against whatever is current later.

Each scenario is sent to your agent. If your agent returns nothing, that case is recorded as an error and the judge is never called — there is nothing to grade, and grading an absence is how a broken integration turns into a plausible verdict.

If your agent does reply, the reply is graded against the scenario's expectations and your policy text. Every verdict is put to two independent models. If they agree, that is the verdict. If they disagree, a third settles it. If the disagreement cannot be settled, the case is recorded as unresolved and excluded from the score.

Runs continue through failure. One dead endpoint on scenario three still leaves thirteen scenarios of evidence.
