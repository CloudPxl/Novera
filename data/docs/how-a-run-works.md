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

A run is graded in slices of under a minute, because that is how long one server call may last. A slice starts a scenario only if it can still finish it, judging by how quickly your agent has been answering; the rest waits for the next slice. On the three trial runs, grading uses Novera's own model keys, which every trial workspace shares. At most two runs grade on them at once; a third waits its turn and says so, then continues on its own. On your own model key there is no queue. You can stop a run that has not finished — its graded scenarios are kept, no report is sealed, and the run records who stopped it.

If a run stops being advanced — the page was closed, a pipeline died — and grades nothing for 24 hours, it is stopped: its graded scenarios are kept, no report is sealed, and a new run is the way forward, so a report never mixes replies from different days.

Runs continue through failure. One dead endpoint on scenario three still leaves the rest of the suite as evidence.

Three things are counted separately and never as passes: a scenario that errored, a scenario that never ran, and a scenario whose expected action nothing could evidence. If scenarios never ran, the grade is `INCOMPLETE` and the remedy is to run the suite again. If everything ran and the evidence still does not support a letter, the grade is `WITHHELD`, and the remedy is different.

## Reading one scenario

Open a scenario on the run page and its evidence is laid out in the order Novera gathered it: what was sent, what your agent replied, the tools it called, the scenario's rules, what your own system showed, the graders — each model with its vote — and the verdict. A step that was empty or never reached says so: a scenario settled by a rule shows that no read-back ran and no model was asked, and a scenario with no result shows why the graders could not give one.

Under the run's verdict counts, the run page also shows how the grading went: for each model vendor, how many requests were sent and answered, how many were rate-limited, timed out or failed, and the slowest answer. It is counted from what was stored for the run, not estimated.

A failed scenario can be diagnosed: a model reads the stored evidence and proposes a change to the policy version the run used. It is a proposal, and nothing changes until you approve it. A scenario with no result has no failure to explain, so it is not diagnosed — retest it instead.

## When you disagree with a verdict

You cannot change a verdict, and neither can we. What you can do is record your own finding beside it: open the scenario on the run page, say whether you find that it passed or failed, and say why. A reason is required, because a finding with no reason is an assertion rather than evidence.

Your finding is kept next to the automated verdict and never replaces it. It changes no count, no grade and no score. Changing your mind records a second finding; the first stays on record. A client report already sealed from the run does not change either — its hash is what proves nothing was edited after it was issued.

The run page shows how often people who reviewed verdicts agreed with them. A finding on a scenario that produced no automated result is counted separately: it fills a gap rather than agreeing or disagreeing with anything. Where your findings differ from the verdicts, the run page also shows what the run would look like read your way, as a comparison and not as a score.

### Putting your review in front of a client

A report is sealed the moment its run completes, so it cannot contain a review written afterwards. If you want a client to see your findings, issue a new report from the run page. The new report carries the original unchanged, adds a section listing every verdict you disagreed with and the reason you gave, states the result with your findings applied, and names the report it reissues by its hash. The original keeps working and keeps verifying.

The new report says plainly that the reviewers are members of the workspace whose agent was tested, and that their findings change no verdict, grade or score. That is deliberate. Some testing tools let a reviewer's "false positive" recalculate the grade; that suits an internal risk dashboard, but a report you hand to an auditor would then be one you graded yourself. Showing both readings side by side lets the reader judge the difference.

A reason that quotes your policy text word for word is refused, because a report never contains the policy itself. Reword it and issue again.
