# Suite Builder — audit of what exists, 2026-10-03

HEAD `f050fe7` on `main`, working tree clean apart from the operator's own
`monitor_claude_usage.py`. Production serves `f050fe7` (the IA polish deploy, checked
34/34 on 2026-10-03). 55 migrations, 629 tests.

The question: how much effort does it take a customer to get from "I connected an agent"
to "I am running a suite I can defend", and what already exists to shorten that
without letting a generated assumption pass for the customer's approved policy.

## What exists today

| Capability | Where | State |
|---|---|---|
| Built-in suites | `data/suites/eu-support-v1…v5.json`, `suites.workspace_id is null` | v5 (49 scenarios) is the default suite. Ground-truth labels for every v5 scenario against the scripted fixture (`eu-support-v5.labels.json`, 33 expected fail, 16 expected pass). Calibration recorded in DECISIONS (v3 sweep; T42–T49 on the route judges, no false pass) |
| Whole-suite import | `importSuite` (`src/lib/workflow/actions.ts`), `ImportSuite` component | A member uploads a complete suite file; it becomes a runnable workspace suite at once, with file hash provenance (0014). No per-scenario approval |
| Dataset import | `src/lib/imports/datasets.ts`, `importScenarioDrafts` | Promptfoo, DeepEval, LangSmith, Langfuse → `scenario_drafts` (origin `import`), file and item hashes frozen (0030) |
| Policy extraction | `src/lib/scenarios/compile.ts`, `draftScenariosFromPolicy` | A model drafts up to six scenarios from the agent's **latest policy version**; each must quote a passage found verbatim in that policy (`locateQuote`), compound assertions refused, the suite validator applied. Stored as `scenario_drafts` (origin `policy`) |
| Production failures | `src/lib/regressions/record.ts`, 0031, 0044 | Redacted, original kept as a hash, drafted from the person's own expectation (no model), origin `production`, linked for good |
| Human approval | `scenario_drafts_forward_only()` (0022/0031) | draft → approved (named) → included, or draft → rejected (named, with reason). Scenario text frozen at insert; editing means a new draft |
| Promotion | `promoteApprovedScenarios`, `buildPromotedSuite` | Always a new suite version; duplicate ids refused; provenance names policy/import/production origins and the promoter |
| Scenario versioning | `suites (workspace_id, key, version)` unique | New version per promotion |
| Assistant | `src/lib/assistant/core.ts` | Links to allowed paths and offers a run the person presses; cannot approve anything. Knows nothing about drafts |
| Agent discovery | `src/lib/agents/discover.ts`, `probes.response_shape` (0023) | Response-path discovery from the probe. Tool names the agent actually called are stored per case in `run_cases.tool_activity`, but nothing reads them as observations |
| Outbound safety | `src/lib/net/public-url.ts`, `read-body.ts` | Public addresses only, re-checked at connect time; capped reads |
| Data routing | `src/lib/privacy/data-class.ts`, the router | Every model call classed; free tiers that train get nothing of the customer's |
| Report readiness | `src/lib/report/readiness.ts` (0053) | Computed from the sealed document only |

## Confirmed gaps

1. **A suite version is not immutable in the database.** `suites` has no update or delete
   trigger (checked every migration; `refuse_mutation` covers policies, run_cases, probes
   and later evidence tables, never suites). Nothing in the code mutates one, but the
   product's claim — "a version never changes once published" — rests on convention
   for the one table every score is out of.
2. **A draft can be inserted already approved.** The forward-only trigger runs on update
   and delete only. Every insert in the code writes `draft`, but a service-role insert
   with `status = 'approved'` is accepted, so "nothing a model wrote reaches a suite
   without a person's name" is enforced on transitions, not on arrival.
3. **The only document a draft can come from is a policy version the customer already
   wrote.** No paste, upload or URL; no way to draft from a help-centre page or a refund
   policy without first turning it into the agent's policy.
4. **No curated starting point smaller than the whole suite.** A customer runs all 49 v5
   scenarios or writes their own. There is no pack, no quick start, and no way to say
   "this baseline scenario does not apply to us" with a reason.
5. **Every run seals a report.** There is no way to try a suite before approving it
   without producing a sealed document that looks like a conformity report.
6. **Ambiguity has nowhere to go.** A drafted scenario either quotes a passage or is
   refused. "Refunds within 30 days — but does the agent execute the refund or escalate
   it?" cannot be recorded as an open question for the customer to answer.
7. **Observed behaviour is never compared with declared policy.** The tools an agent
   called are stored and never read back as a fact about the agent.
8. **Draft states are too few for review.** No `not_applicable` (with a reason, distinct
   from rejected), no `needs_review`, no bulk approval and no record of a group approval.
9. **Drafts cannot be gathered into a piece of work.** Drafts are a workspace-wide pile;
   an agency cannot prepare one client's suite and hand it to that client to approve.

## Decision

Build the Suite Builder **on the existing draft table and approval trigger**, not
beside them. A builder candidate is a `scenario_drafts` row with two new origins
(`pack`, `document`) and one more (`discovery`); approval, rejection, inclusion and the
freeze stay exactly as they are, and the new states join the same trigger. Three new
tables hold what has no home today: a build (`suite_builds`), its sources
(`suite_sources`), and the obligations and open questions extracted from them
(`suite_obligations`).

Curated packs are **selections of already-measured eu-support v5 scenarios**, byte-
identical, so every pack scenario carries a ground-truth label and the v5 calibration
behind it. Packs that would need new scenarios (e-commerce, SaaS/B2B, multilingual) are
recorded as drafts and not offered: a pack with unmeasured scenarios is exactly the
"tested" claim the product refuses to make.

An exploratory scan is a run of a suite marked `exploratory`, and the database refuses
a report for it. It is labelled everywhere it appears; pipelines read it as incomplete.

Not in this milestone: PDF parsing (DOCX, Markdown, plain text and HTML pages are
supported), crawling beyond one page per request, selecting an existing run case as a
candidate, and the optional human-assisted services (designed in the decision log, not
published).
