---
title: How a run works
published: true
---
A run names three things at the moment it starts: the agent, the policy version, and the suite version. It executes against those, not against whatever is current later.

Each scenario is sent to your agent. If your agent returns nothing, that case is recorded as an error and the judge is never called — there is nothing to grade, and grading an absence is how a broken integration turns into a plausible verdict.

If your agent does reply, the cheapest sufficient check runs first.

Some scenarios carry rules — a forbidden tool, a required approval, text that must or must not appear. A rule can fail a scenario and can never pass one, because "did not say the forbidden thing" is not the same as "did what was expected". When a rule settles a case, no model is asked and the report names the rule rather than quoting a model's prose.

Where a scenario expects something to change in your own systems and you have given Novera a read-only endpoint to check, that read-back runs next — before any model. If your system of record contradicts what your agent said, the case fails on that basis.

Anything still open goes to the models. On the trial allowance, every verdict is put to two models from different vendors. On your own key it is put to the models you named for that key — one vendor, so the report labels each verdict as corroborated within one vendor, or not corroborated if you named a single model. If they agree, that is the verdict. If they disagree, a third settles it. If the disagreement cannot be settled, the case is recorded as unresolved and excluded from the score.

Runs continue through failure. One dead endpoint on scenario three still leaves the rest of the suite as evidence.

Three things are counted separately and never as passes: a scenario that errored, a scenario that never ran, and a scenario whose expected action nothing could evidence. If scenarios never ran, the grade is `INCOMPLETE` and the remedy is to run the suite again. If everything ran and the evidence still does not support a letter, the grade is `WITHHELD`, and the remedy is different.

## When you disagree with a verdict

You cannot change a verdict, and neither can we. What you can do is record your own finding beside it: open the scenario on the run page, say whether you find that it passed or failed, and say why. A reason is required, because a finding with no reason is an assertion rather than evidence.

Your finding is kept next to the automated verdict and never replaces it. It changes no count, no grade and no score. Changing your mind records a second finding; the first stays on record. A client report already sealed from the run does not change either — its hash is what proves nothing was edited after it was issued.

The run page shows how often people who reviewed verdicts agreed with them. A finding on a scenario that produced no automated result is counted separately: it fills a gap rather than agreeing or disagreeing with anything.
