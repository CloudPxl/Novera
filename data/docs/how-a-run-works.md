---
title: How a run works
published: true
---
A run names three things at the moment it starts: the agent, the policy version, and the suite version. It executes against those, not against whatever is current later.

Each scenario is sent to your agent. If your agent returns nothing, that case is recorded as an error and the judge is never called — there is nothing to grade, and grading an absence is how a broken integration turns into a plausible verdict.

If your agent does reply, the cheapest sufficient check runs first.

Some scenarios carry rules — a forbidden tool, a required approval, text that must or must not appear. A rule can fail a scenario and can never pass one, because "did not say the forbidden thing" is not the same as "did what was expected". When a rule settles a case, no model is asked and the report names the rule rather than quoting a model's prose.

Where a scenario expects something to change in your own systems and you have given Novera a read-only endpoint to check, that read-back runs next — before any model. If your system of record contradicts what your agent said, the case fails on that basis. A 404 from the read-back is reported as unable to verify, because Novera cannot tell a missing record from a wrong address. If your system answers 404 only for a record that does not exist, say so on the agent's read-back settings; a 404 then fails the case as a record not found, unless the answer is an HTML page, which is what a wrong address usually gets. A run keeps the setting it started with.

Anything still open goes to the models. On Novera's keys (the trial, Agency Pro's managed runs, a grant), every verdict is put to two models from different vendors. On your own key it is put to the models you named for that key — one vendor, so the report labels each verdict as corroborated within one vendor, or not corroborated if you named a single model. If they agree, that is the verdict. If they disagree, a third settles it, from a third vendor on Novera's keys. If the disagreement cannot be settled, the case is recorded as unresolved and excluded from the score.

When a scenario lacks a verdict only because Novera's graders were busy — a model was rate-limited, slow or erroring, or the slice ended before the second model was asked — the scenario is not recorded yet. Your agent's reply is kept and graded again in a later slice, up to four times about half a minute apart: the opinions already given stand, a model that already answered is not asked again, and your agent is never sent the scenario twice. The run page says how many answered scenarios are waiting for a grader. Only if the graders stay unavailable is the scenario recorded without a result, and the run finishes only when every scenario is recorded.

A run is graded in slices of under a minute, because that is how long one server call may last. A slice starts a scenario only if it can still finish it, judging by how quickly your agent has been answering; the rest waits for the next slice. Without your own model key — on the trial, Agency Pro's managed runs or a grant — grading uses Novera's own model keys, which every such workspace shares. At most two runs grade on them at once; a third waits its turn and says so, then continues on its own. On your own model key there is no queue. You can stop a run that has not finished — its graded scenarios are kept, no report is sealed, and the run records who stopped it.

If a run stops being advanced — the page was closed, a pipeline died — and grades nothing for 24 hours, it is stopped: its graded scenarios are kept, no report is sealed, and a new run is the way forward, so a report never mixes replies from different days.

Runs continue through failure. One dead endpoint on scenario three still leaves the rest of the suite as evidence.

## When your agent's platform pushes back

Before the first scenario, a run sends your agent one harmless check message, the same one **Test connection** sends. If nothing usable comes back (a refused key, a missing input variable, a web page instead of the API), the run stops there: no scenario is sent, nothing is recorded, no run is spent, and the run page says what came back.

Scenarios go to your agent three at a time, a quarter of a second apart, unless its connection asks for one at a time or a longer gap. When the platform says it is over a limit (HTTP 429, or a rate, quota or concurrency error inside its answer), Novera waits 2 seconds, then 5 (or what the platform asks for, up to 20), and sends that scenario again. A limit reported inside an answer is retried only for a scenario's first message and only when the scenario cannot act on anything, because the platform may have run part of its work. From the first limit on, the run sends one scenario at a time with a gap that grows up to 8 seconds. A limit that does not lift stops the run after three scenarios in a row.

When three scenarios in a row fail the same way (the same error code, the same empty answer, the same missing field), Novera sends the check message again. If that fails too, the cause is the connection, not the scenarios, and the run stops; the rest are not sent. If the check message is answered, the cause is in those scenarios (a filter that refuses some messages, a branch of the agent's flow that ends without an answer) and the run continues. A run stopped either way is never sealed, and a CI gate reads it as a configuration problem (exit 3).

When a step inside the agent's workflow fails part-way (a Dify node whose HTTP call or model failed, say) and no reply follows, the scenario is sent once more after a moment, under the same rule as a server error: only its first message, and only when the scenario cannot act on anything. What the second attempt answers is the result; if it fails again, the scenario says it failed on two attempts and names the step. It is never recorded as a pass or a fail.

When something in front of the agent refuses a message (HTTP 413, a firewall, a content filter), the agent never read it, so its behaviour on that scenario was not observed: the scenario has no result, never a pass, even when refusing that input looks like the right outcome. The scenario says so and where to look.

Whenever the platform said why it refused or failed, its words are quoted on the scenario: an error code and message, cleaned to one line and with anything that looks like a key, an address or a card number replaced.

Three things are counted separately and never as passes: a scenario that errored, a scenario that never ran, and a scenario whose expected action nothing could evidence. If scenarios never ran, the grade is `INCOMPLETE` and the remedy is to run the suite again. If everything ran and the evidence still does not support a letter, the grade is `WITHHELD`, and the remedy is different.

## Reading one scenario

Open a scenario on the run page and its evidence is laid out in the order Novera gathered it: what was sent, what your agent replied, the tools it called, the scenario's rules, what your own system showed, the graders — each model with its vote — and the verdict. A step that was empty or never reached says so: a scenario settled by a rule shows that no read-back ran and no model was asked, and a scenario with no result shows why the graders could not give one.

Under the run's verdict counts, the run page also shows how the grading went: for each model vendor, how many requests were sent and answered, how many were rate-limited, timed out or failed, and the slowest answer. It is counted from what was stored for the run, not estimated.

A failed scenario can be diagnosed: a model reads the stored evidence and proposes a change to the policy version the run used. It is a proposal, and nothing changes until you approve it. Approving creates a new policy version; it does not change this run or its report. The approved change then shows its next steps in place: retest this scenario against the new version, and rerun the whole suite compared with this run, so a fix here is not a break somewhere else.

**Try this scenario alone** sends one failed or no-result scenario to your agent again, against the newest policy version, and grades it exactly as a run would. The result appears in place, labelled "Single-scenario check — not a sealed run.": it is never sealed, never counted in a score, a coverage figure or a report, and never spends one of the trial's runs. A destructive scenario is refused against an agent marked as production, as in a run. A workspace can run 20 of these checks in any hour; the API offers the same check (see **API**).

A scenario with no result says why: whether your agent received it at all, who acts on it (your agent, your configuration, Novera's graders, or you), whether a retest could repeat something your agent did, and the next step. Retesting sends the scenario to your agent again, so where your agent received it and can act, Novera says to check your own system first. A scenario with no result has no failure to explain, so it is not diagnosed, and editing the policy will not change it. **Review → Evidence incomplete** groups these across your recent runs by reason.

## When you disagree with a verdict

You cannot change a verdict, and neither can we. What you can do is record your own finding beside it: open the scenario on the run page, say whether you find that it passed or failed, and say why. A reason is required, because a finding with no reason is an assertion rather than evidence.

Your finding is kept next to the automated verdict and never replaces it. It changes no count, no grade and no score. Changing your mind records a second finding; the first stays on record. A client report already sealed from the run does not change either — its hash is what proves nothing was edited after it was issued.

The run page shows how often people who reviewed verdicts agreed with them. A finding on a scenario that produced no automated result is counted separately: it fills a gap rather than agreeing or disagreeing with anything. Where your findings differ from the verdicts, the run page also shows what the run would look like read your way, as a comparison and not as a score.

### Putting your review in front of a client

A report is sealed the moment its run completes, so it cannot contain a review written afterwards. If you want a client to see your findings, issue a new report from the run page. The new report carries the original unchanged, adds a section listing every verdict you disagreed with and the reason you gave, states the result with your findings applied, and names the report it reissues by its hash. The original keeps working and keeps verifying.

The new report says plainly that the reviewers are members of the workspace whose agent was tested, and that their findings change no verdict, grade or score. That is deliberate. Some testing tools let a reviewer's "false positive" recalculate the grade; that suits an internal risk dashboard, but a report you hand to an auditor would then be one you graded yourself. Showing both readings side by side lets the reader judge the difference.

A reason that quotes your policy text word for word is refused, because a report never contains the policy itself. Reword it and issue again.

## Comparing two runs

A run compared with an earlier run of the same suite lists what was fixed, what newly broke, what still fails and what lost its result — and says why each one moved. Novera keeps a fingerprint of every reply, so it can tell "the agent's reply changed" from "the agent's reply was identical; the graders changed". A verdict that moved on an identical reply is never presented as your agent improving or regressing. Above the lists it states what else differed between the runs: the policy version, the grading instructions, the graders, how Novera calls your agent, or the release you declared.
