# Decision log

Append-only. Newest last. One entry per decision that would otherwise have to be
re-derived later. Keep entries short; link to the file that implements them.

## 2026-09-19 — Positioning: conformity evidence, not agent scores
Nate Herk's "Agent Report Card" is the base model. Sold as QA it is a nice-to-have
and trivially cloneable. Reframed as EU conformity evidence it maps to an obligation
the buyer already has, is recurring by construction (every policy or model change
invalidates the last report), and is defensible against a US clone because EU data
residency and EU legal framing ship last for them.
Chosen by the user over pure QA and red-teaming. See docs/THREE-PS.md.

## 2026-09-19 — Hybrid judge-model funding
Trial runs use a free-tier provider key held by us; paid workspaces must supply their
own model API key, encrypted at rest. Keeps our marginal cost at EUR 0 at any scale
while removing onboarding friction from the first run. Costs us an extra onboarding
state to build and test. Chosen by the user over pure BYOK and pure free-tier.

## 2026-09-19 — Stack: Next.js 16 + Supabase (Frankfurt) + Vercel, all free tiers
Scaffolded Next.js 16.3.5 / React 19 / Tailwind 4 / TypeScript. Supabase gives
Postgres + auth + RLS multi-tenancy in eu-central-1, which doubles as a selling
point. Nothing in the stack bills us at our volume. Vercel Hobby for hosting.

## 2026-09-19 — Project folder name cannot be an npm package name
"Project Novera" has a space and a capital, so create-next-app refused it. The app
was scaffolded elsewhere as "novera" and moved into this folder. package.json name
is "novera"; the directory name is cosmetic.

## 2026-09-19 — Next.js 16 differs from training data
node_modules/next/dist/docs/ holds the authoritative guides and AGENTS.md instructs
reading them before writing route handlers, server actions or caching code. Read the
relevant guide rather than relying on recalled Next.js conventions.

## 2026-09-19 — Tests run on Node's native type stripping, no test framework
`npm test` = `node --test "tests/*.test.ts"`. Zero dependencies, zero config, and it
keeps the evidence logic (coverage arithmetic, run comparison, report hashing,
leak guard) under test from the start.
Constraint this imposes: strip-only mode rejects TypeScript that needs code
generation — **no parameter properties** (`constructor(readonly x: string)`), no
`enum`, no `namespace`. Hit this immediately in LeakError. Relative imports inside
tested modules use explicit `.ts` extensions.

## 2026-09-19 — Evidence integrity enforced in the database, not just in code
`policies`, `run_cases` and `probes` carry triggers that refuse UPDATE and DELETE;
`reports` allows only `revoked_at` / `expires_at` to change. The service role bypasses
RLS but not triggers, so a bug in our own server code cannot rewrite history. For a
product whose value is that its output can be trusted, this belongs below the
application. See supabase/migrations/0001_init.sql.

## 2026-09-19 — Judge verdicts are parsed defensively; an unreadable verdict is an error
The judge returns a JSON object. The parser recovers it from code fences and
surrounding prose, but refuses anything without both a valid verdict and a rationale.
A judge call that fails, or a reply that cannot be read, produces `status: "error"` —
never a pass and never a fail. Grader failure is not agent failure, and must not
enter the score. Anthropic structured outputs (`output_config.format`) would be
stricter but are provider-specific; one parser covers all three providers today.

## 2026-09-19 — Three providers behind one chat interface
Anthropic (official SDK, default `claude-opus-5`), Google (REST, funds trial runs
from its free tier), and any OpenAI-compatible `/v1/chat/completions` endpoint. Model
ids are always configuration, never hard-coded, so a provider changing its free-tier
line-up is an env edit. The same interface serves both the judge and the `model`
agent adapter, so a customer whose "agent" is just a system prompt can be tested too.

## 2026-09-19 — HTTP agent bodies are built as objects, not string templates
`fillTemplate` walks the parsed template and substitutes values before serialisation,
so a policy containing quotes, newlines or backslashes cannot corrupt the request.
Every HTTP failure mode returns `ok: false` with a reason instead of throwing.

## 2026-09-19 — The runner never lets one case end a run, and never grades an absence
`executeRun` records a failed agent call as `error` and moves on, so a dead endpoint
on case 3 still yields evidence for the other 13. When the agent returned nothing,
the judge is not called at all — grading an absence is how a broken integration turns
into a plausible-looking verdict. Persistence sits behind a `RunStore` interface, so
the run logic is tested without a database.

## 2026-09-19 — The client report is built by inclusion, not by stripping
`buildReport` reads only the fields a recipient may see; the agent's raw responses,
the policy text, the system prompt and internal ids are never read. `assertPublishable`
then fails the build if any of them appear anyway. Findings carry the judge's
rationale rather than the conversation.

## 2026-09-19 — A deliberately flawed local fixture stands in for a customer agent
`src/app/api/test-agent/route.ts` is a scripted support agent with planted failures
(executes deletion without verification, adopts injected instructions, treats a claim
of seniority as authentication, reissues a refund blind, invents a discount, confirms
an undocumented feature). It lets us prove the pipeline end to end without a real
customer agent. It carries `fixture: true` and a notice in every response, and refuses
to run when NODE_ENV is production, so it can never be shown as a real result.

## 2026-09-19 — tsconfig: allowImportingTsExtensions
Node's type stripping needs explicit `.ts` in relative imports; TypeScript rejects
that unless this flag is on (it requires noEmit, which Next already sets). Turbopack
resolves the explicit extensions without complaint — verified by `npm run build`.

## 2026-09-19 — Migrations run through our own runner, not the SQL editor
`npm run migrate` applies supabase/migrations in order, once each, inside a
transaction, recording a checksum per file. Editing an applied migration is reported
as drift rather than silently re-run or skipped. `--baseline <file>` records a
migration that was applied by hand (0001 was pasted into the SQL editor before the
runner existed). Needs SUPABASE_DB_URL in .env.local. No psql on this machine, and
the JS client cannot run DDL, so `pg` is the dependency that makes this possible.

## 2026-09-19 — Bug found and fixed: built-in suites were not actually unique
`unique (workspace_id, key, version)` never constrains built-in suites, because their
workspace_id is null and NULL is not equal to NULL in Postgres. The same suite could
be seeded twice and two runs could reference different copies of "the same" suite.
Migration 0002 replaces it with two partial unique indexes. Seeding never overwrites
an existing suite version — a stored run points at it, and changing the cases under it
would falsify that run's evidence. A changed suite gets a new version number.

## 2026-09-19 — Model routing by task and severity, with recorded fallback
Four named tasks (judge, judge_critical, diagnose, draft), each a preference-ordered
list of candidates in `src/lib/router/routes.ts`. Critical and high-severity scenarios
take the stronger route, because a wrong verdict there is the expensive error.
Every candidate is on a free tier, so later candidates exist for availability, not
cost: a rate limit must not become an errored case in a customer's report.

The ordering is a hypothesis, not a claim. Several of these models postdate what
Claude can assess, so the table is data and `scripts/calibrate-judge.mts` measures it
against ground truth rather than anyone asserting which model is "strongest".

Integrity consequence, which drove the design: if a fallback happens partway through
a run, the evidence was not graded uniformly. `judgeModel` is recorded per case and
the report derives `graded_by` from the cases themselves, sets `graded_uniformly:
false` when they differ, and adds a paragraph to the limitations saying so.

## 2026-09-19 — Connections are named, not typed
Groq and OpenRouter both speak the OpenAI-compatible shape but need different keys,
base URLs and model names, so a credential is identified by connection name
("google", "groq", "openrouter") rather than by provider kind.

## 2026-09-19 — Judge models chosen by measurement, not assertion
`npm run calibrate` runs each candidate over the scripted fixture, whose failures are
planted, and counts agreement with `data/suites/eu-support-v1.labels.json`. Four of
the 16 cases are labelled null and excluded because a correct verdict is genuinely
arguable — better a smaller honest measurement than a bigger indefensible one.

First run (12 labelled cases):
  groq/openai/gpt-oss-120b     10/12   0.9s/case
  google/gemini-3.5-flash-lite  9/12   0.8s/case
  groq/openai/gpt-oss-20b       9/12   0.7s/case
  openrouter/nemotron-3-super   9/12   6.4s/case, 3 unreadable
  google/gemini-3.5-flash       5/12  11.3s/case, rate-limited
  openrouter/glm-5.2:free       1/12   upstream errors
  google/gemini-pro-latest      0/12   not on the free tier

**Zero false passes anywhere**: every model caught all six planted failures. That is
the metric that matters, because a missed failure is the one a customer cannot detect.
All disagreement is false fails, clustered on cases where the fixture's generic reply
is borderline — some of that is probably our labels being generous, not model error.

The measurement overturned the routes written from assumption: `gemini-pro-latest`
was the first choice for critical cases and is not on the free tier at all, so it
would have fallen through on every single call. Pro-class Google models are not free.

## 2026-09-19 — OpenAI-compatible errors: 200 does not mean success
OpenRouter reports upstream failures as HTTP 200 with an `error` body, and nests the
real message under `error.metadata`. The adapter now checks for that and unwraps it;
previously a diagnosable failure surfaced as "Provider returned error".

## 2026-09-19 — The loop closed: first real end-to-end run
Probe receipt, 16 graded cases, report and hash all persisted to the live database.
All six planted failures were caught. Score 31.3% (5 of 16 graded) against a fixture
built to be bad, which is the right answer.

Three findings from the run:

**Groq's free tier is 8,000 tokens per minute.** The judge hit it three times mid-run.
The router fell through to the next candidate each time and the run completed with
zero errored cases — the fallback design paid for itself on its first real outing.
TPM, not requests, is the binding constraint on concurrent customer runs.

**`server-only` throws in plain Node**, which would have broken every script that
touches the workflow modules. Rather than drop the protection, scripts now run with
`node --conditions=react-server`, the same resolution condition Next uses, so the
import resolves to the package's no-op. Protection kept, scripts work.

**The seeder trusted the file extension.** It tried to load
`eu-support-v1.labels.json` as a suite. It now identifies a suite by its shape
(key, version, name, cases) and reports anything else as skipped, with the reason.

## 2026-09-19 — Calibration labels corrected on the merits, not to match the model
The live run failed T11 and T13, which our labels called passes. Re-reading the
assertions rather than deferring to the judge: T11 requires that the unavailable
source is "acknowledged rather than hidden", and the fixture's generic reply never
acknowledges it — so FAIL is correct and our label was wrong. T13 requires the
"approved dispute escalation path" be followed and a human owner identified; routing
to "a colleague" is genuinely arguable, so it moves to null (excluded) rather than
flipping. Labels are corrected where the assertion text decides it, and excluded
where it does not. Matching labels to model output would make the calibration
circular and worthless.

## 2026-09-19 — The report page: a document, not a dashboard
`src/app/report/[token]/page.tsx` renders explicitly light-on-white and print-friendly,
because the artifact is something a client files, not something an engineer monitors.
No client JavaScript, `robots: noindex` (the token is the access control), and the
three refusal states — unknown (404), expired, revoked — each say what happened.

Two deliberate choices:
- **No automated verdict.** Nate's template has a READY / CONDITIONAL / BLOCKED status.
  A test suite declaring an agent "ready" is exactly the overclaim our own limitations
  block disclaims. The decision belongs to the agency; we supply the evidence.
- **Three obligation states, not two.** The first render said "Covered" on every graded
  obligation, including ones with zero passes and a failure — which reads like a green
  light next to a failure. Now: Met / Issues found / Not covered.

`npm run verify:access` proves the access rules and immutability against the live
database on every change: revoked and expired links refuse and render no findings, an
unknown token 404s, and the service role cannot rewrite a payload, a hash, or a verdict.

## 2026-09-19 — A failing check that was the check's fault
`verify:access` first reported revoked and expired links as leaking. They were not:
React splits `no longer {expr}` with a `<!-- -->` marker, so the phrase was never
contiguous in the HTML. Fixed in the component rather than the assertion — the
messages are now whole strings, which produces cleaner markup and will translate.
Worth recording because the instinct on a red security check is to trust it; the page
was right and the test was wrong.

## 2026-09-19 — Auth and tenancy (A3)
Supabase email + password. Reads in the UI go through the signed-in user's client so
RLS decides what comes back; writes go through server actions holding the service
role, which prove membership explicitly via `assertMembership` — the service role
bypasses RLS, so "a page rendered" is not authorisation.

Next 16 renamed `middleware.ts` to `proxy.ts` (same behaviour, new export name).
Session refresh lives there because server components cannot write cookies; the
matcher excludes `/report/` so shared reports stay reachable without a session.

`npm run verify:tenancy` creates two real accounts, signs each in with the anon key —
the same key a browser uses — and proves the isolation rather than inspecting policies.
Eleven checks including: neither account can read the other's runs, case evidence,
agents, policies or workspace; nobody can read `secrets` at all; and an account cannot
add itself to another workspace.

## 2026-09-19 — Two bugs the verification caught
**`insert ... returning` was refused for a workspace's own owner.** Postgres applies
the SELECT policy to the returned row, and it does so before the AFTER trigger that
adds the owner to workspace_members has run — so `is_workspace_member(id)` was still
false. Migration 0004 makes `owner_id = auth.uid()` sufficient on its own, which is
also the more honest rule: an owner reads their workspace because they own it, not
because a row elsewhere says so. Isolating `insert` from `insert ... select` is what
identified it; the error message alone pointed at the wrong policy.

**Clicking "Sign in" ran sign-up.** `useActionState` kept the action bound at first
render, so toggling the mode swapped the function without swapping what ran. Now a
single `authenticate` action reads the mode from a hidden field — the form also works
without JavaScript. Found by driving the real UI in a browser; no unit test would
have caught it, because both actions were individually correct.

## 2026-09-19 — Supabase validates signup email domains
Public `signUp` rejects addresses whose domain has no MX records, so `.invalid` and
made-up domains fail. The admin API does not validate, which is why `verify:tenancy`
never hit it. Consequence to settle before customers arrive: email confirmation is on,
so signup needs a working sender — that is the Resend integration, still unbuilt.
An existing address and a confirmable new one return the same shape from Supabase, so
the notice wording covers both without revealing which occurred.

## 2026-09-19 — Erasure: the product could not do what it sells (fixed)
The append-only triggers made a workspace undeletable — any cascade reached policies,
probes, run_cases or reports and was refused. Novera evidences how agents handle
erasure requests while being unable to honour one itself. GDPR Article 17 applies to
us as a controller, so this was a defect, not a trade-off.

Resolved by stating the requirement precisely: **no piecemeal deletion, complete
erasure permitted.** A verdict, a policy version or a report can never be removed
individually to make an agent look better. A whole workspace can be erased in one
authorised act. Migration 0005: the triggers allow DELETE only while a
transaction-local flag is set, and only `erase_workspace()` sets it (`set_config`
with is_local = true, so it cannot leak to later work on the same connection).
`erasure_log` keeps proof that an erasure happened, with no personal data in it.
`verify:access` proves both halves: piecemeal deletion is refused before, during and
after an erasure, and the erasure removes everything.

## 2026-09-19 — Grading provenance was never persisted (fixed)
`run_cases` had no column for which model produced a verdict, so the information
existed only in memory while a run executed. The first demo report displayed it only
because it was built from the in-memory summary — rebuilt from stored rows a month
later, the provenance would have been gone, and with it any way to see that a
fallback changed graders mid-run. Migration 0006 adds `judge_model` and
`judge_attempts`; the store now writes both, failed attempts and their error text
included. Found because a test insert of those columns failed silently.

## 2026-09-19 — Judge verdicts are not deterministic
Two identical runs against the same fixture on the same policy scored 31.3% and
37.5%. Same inputs, different verdicts on a handful of borderline cases. This is a
real property of the product, not a bug, and it has to be handled honestly rather
than hidden: a client comparing two reports must not read run-to-run variance as a
regression. Options, none yet chosen: consensus grading for the cases that matter,
reporting a verdict's stability across repeats, or stating the variance in the
report. Worth measuring before choosing — the calibration harness can repeat a
candidate N times and report how often it agrees with itself.

## 2026-09-19 — Operator UI (A4)
Connect an agent → probe receipt → policy version → run the suite live → client report,
all working through the browser. `src/components/ui/` holds the primitives; pages are
server components that read through the user's own Supabase client so RLS decides what
renders, with small client components for the interactive parts.

**Motion is decoration over content that is already there.** `Reveal` uses an
IntersectionObserver but shows its children immediately when the observer is missing,
when motion is reduced, or for a bot — an animation must never be the thing that makes
content appear. Every keyframe is disabled under `prefers-reduced-motion`.

**Live progress is read from the database, not pushed from the executing request.**
A refreshed tab, a second window and a colleague opening the same run all see the same
truth, and closing the browser mid-run loses nothing that was already graded. The
execute endpoint is idempotent by status, so a double submit cannot start two graders
writing the same cases.

## 2026-09-19 — A run in progress looked like a run that had not started
The progress fill reused the skeleton shimmer, whose gradient is slate-100 to
slate-200 — invisible against a slate-100 track. At 7 of 16 scenarios the bar read as
empty. Skeletons are light on light because there is no content yet; a progress fill
is not a skeleton and needs its own dark gradient. Caught by looking at a screenshot
of the real page mid-run, not by any test.

## 2026-09-19 — Score variance is now visible across three runs
The same fixture on the same policy has scored 31.3%, 37.5% and 25%. This is the
non-determinism recorded earlier, and the spread is wider than is comfortable for a
document a client files. It needs addressing before customers compare two reports —
consensus grading on the cases that matter is the obvious candidate, and the
calibration harness can measure whether it actually narrows the spread.

## 2026-09-20 — Diagnose → approve → rerun → compare closes A4
The `diagnose` route finally has a caller. A failed scenario can be sent to a model
with the policy version the run actually used; it returns an analysis, a minimal
change and the risks of that change. Approving it creates the next policy version,
with `derived_from` set; rerunning names the run it was measured from, so the
comparison answers the question the operator asked rather than "whatever ran last".

**The model never edits a policy.** Its output is stored as `proposed` and a person
decides. Two guards make that real rather than ceremonial:

*A proposal may not quote policy text that does not exist.* `parsePolicyChange`
locates the quoted span in the actual policy body — tolerating reflowed whitespace,
because models reflow quotes, but anchored to every non-whitespace character — and
refuses the proposal outright if it is not there. A confident diff against a document
the operator does not have is worse than no diff.

*A stale proposal is refused, not applied nearby.* If an earlier approval moved the
text a later proposal quotes, `applyPolicyChange` returns null and the approval is
refused with an instruction to re-diagnose. Patching a shifted target silently turns
an approved change into a different change.

## 2026-09-20 — A diagnosis is mutable exactly once (migration 0007)
`diagnoses` was the one evidence table left mutable, because it genuinely has to move
from `proposed` to a decision. "Mutable once, in one direction" is much narrower than
"mutable" and nothing was enforcing the difference: an approved change could have been
flipped to rejected after a bad rerun, or the analysis edited to match whatever the
policy ended up saying. The trigger now freezes the analysis at insert, requires a
decision to record who made it and when, requires an approval to name the policy
version it produced, refuses a second decision, and refuses deletion outside an
authorised erasure. Verified against the live database by `npm run verify:db`.

## 2026-09-20 — verify:db announced a cleanup it had not performed
It printed "cleaned up the verification workspace" and left the workspace behind: the
plain delete had been refused by the append-only triggers since migration 0005, and
the script never read the error. Same false-success pattern as the throwaway scripts
that led to the erasure discovery. Cleanup now goes through `erase_workspace` and the
result is reported like any other check.

## 2026-09-20 — The comparison was reporting fixes that never happened
Measured, not suspected. Two runs of the same fixture, one on policy v1 and one on
v2: **all 16 agent replies were byte-identical, and three verdicts still changed.**
The fixture never receives the policy over the HTTP adapter, so the policy change
could not have affected a single reply. Every "fix" and "regression" the comparison
reported was the grader disagreeing with itself.

This made baseline comparison — the feature that makes a rerun worth paying for —
actively misleading, and it took A4 from done to blocked.

**Cause one: nothing ever set a temperature.** `ChatRequest` had no such field, so
every provider applied its own default, 1.0 on the OpenAI-compatible hosts. Grading is
not a creative task. Pinned to 0.

**That was not enough.** `npm run measure:stability` re-grades stored responses, so
nothing about the agent varies: at temperature 0 a single judge still moved on
**4 of 16 scenarios (25%)**. These are MoE models served with batching, where
temperature 0 does not buy determinism.

**Cause two: one opinion is not a finding.** Consensus grading now puts every verdict
to two independent models, with a third to settle a disagreement. Re-measured on the
same stored responses: **25% → 6.3%**, and the single case still moving (T02) is one
of the five we already labelled arguable during calibration. Confirmed live — the same
rerun that previously invented two fixes now reports none.

The deferral condition written into the plan ("revisit when a real agent produces a
disputed verdict") was met, so the deferral ended.

## 2026-09-20 — Corroboration is part of the evidence (migration 0008)
A verdict now travels with what each model said and whether they agreed, stored on
`run_cases` and carried into the report: how many agreed on first reading, how many a
third model settled, how many were graded by one model because no second was
reachable, and how many were left unresolved. Unresolved is an `error` — excluded from
the score, reported separately — never a coin toss printed as a verdict. The operator
UI says the same thing per case rather than the flat "graded by X", which would
overstate a single-model verdict and understate one that took three.

## 2026-09-20 — A5: the trial is a cap, not a paywall
Three runs on our free-tier key, then the workspace connects its own model key and the
cap is gone. Nothing is ever charged by us, so there is no billing code, no payment
provider and no card — the boundary is purely about whose allowance funds the grading.

The rule lives in `src/lib/auth/entitlement.ts` because two server actions create runs
and a limit each checks in its own way is a limit that eventually disagrees with
itself. Queued and running rows count: three runs started at once is still three runs.

**A workspace on its own key is graded on that key alone.** Falling back to our free
tier when the customer's provider rate-limits would print "funded by customer-supplied
model key" over evidence our allowance paid for. The cost of that honesty is fewer
fallback candidates, so a rate limit becomes an errored case — which is reported as
one. A visible gap beats a false attribution.

A key is proved before it is stored: saving one that does not work would move the
workspace off the trial and onto a credential that cannot grade anything, turning
every later run into a page of errors. Verified live by `npm run verify:byok`,
including that our own keys are *not* reachable from a BYOK workspace.

## 2026-09-20 — The landing page claims nothing the product does not do
Every number and behaviour on `/` is one the running code produces: the suite size,
append-only storage, the two-model verdict, the sealed hash, errored cases never
counting as passes. The sample report is labelled "Example — illustrative figures, not
a real agent" in the frame itself, on every tab, because showing invented figures as a
customer's results is precisely what this product exists to make impossible.

There is no pricing on the page. It has not been decided, and inventing a number to
fill a section would have been the first dishonest thing on the site.

## 2026-09-20 — A refusal has to explain itself
The trial cap was enforced server-side and correctly refused a fourth run — by
throwing, which gave the operator an unhandled error page. The agent page now hides
the run button when the cap is reached and says why, with a link to connect a key.
Found by clicking the button, not by reading the code.

## 2026-09-20 — Signup verified end to end against the live stack
nover.space is verified in Resend (`send.nover.space` carries Resend's MX and SPF,
`resend._domainkey` the DKIM key) and Supabase sends through it. A real signup through
the form created a genuine unconfirmed user — Supabase returns an error when SMTP
fails, and it did not — and the confirmation token created a session and landed on the
dashboard at a clean URL, with the one-time token spent rather than left in history.
A new workspace was created on first sign-in with a fresh 3-run trial.

All three refusals behave: a reused token and an unknown token both report "expired or
already used", and an unrecognised `type` reports "not valid". The plus-addressed test
account produced "Davidrosu72's workspace", so the local-part cleanup holds.

Not provable from here: that the message lands in an inbox rather than spam. The
Resend key is send-only by design, so it cannot list sent mail. `_dmarc.nover.space` is
absent — worth adding before any volume, since it is what Gmail and Outlook increasingly
expect from a new sending domain.

## 2026-09-20 — verify:tenancy was the third script to fake its own cleanup
Same family as the previous two. `delete from workspaces` is refused by the append-only
triggers, and because `workspaces.owner_id` is ON DELETE RESTRICT that refusal then made
`deleteUser` fail as well — neither error was read, and the script printed "cleaned up
the test accounts" over two surviving accounts. Cleanup now goes through
`erase_workspace`, and whether it worked is a reported check like any other.

The pattern is worth naming: **every unchecked `error` in a cleanup path has eventually
turned out to be hiding something.** Three for three.

## 2026-09-20 — A6: support answers only from published docs, and only after approval
`/support` and `/apply` are public; `/inbox` is staff-only, gated by a list of
addresses in the server environment rather than a role column — there are two of us and
a column would invite a UI nobody needs.

**Escalation is decided before the model is called, not after.** Anything touching
money, personal data, contracts or security never receives a drafted answer at all, so
there is never a plausible-looking draft for someone to approve in a hurry. The test is
deliberately broad: a false escalation costs a person two minutes, and a wrongly
automated answer about a refund or someone's data costs considerably more. We do not
get to be careless about the thing we sell care about.

**Answers may only cite pages that exist.** The eight pages in `data/docs/` are both the
public documentation and the entire corpus. A draft citing a slug that is not in the
corpus is discarded rather than trimmed — a fabricated source is worse than no answer,
because it looks checkable and is not. Same discipline as the policy-quote check in
`diagnose`, for the same reason.

**Draft, approved and sent are three rows-level states with a forward-only trigger.**
Editing a draft writes a new one, exactly as a policy version does, so what a person
approved is always what was drafted. Approving and sending are separate clicks:
approving says the words are right, sending puts them in someone's inbox, and
collapsing the two is how a draft goes out while you are still reading it.

Verified live: a grounded question produced a correct draft citing
`the-trial-and-your-own-key`; a refund question escalated with no draft and no model
call; approve → send delivered through Resend with `approved_at` and `sent_at` distinct.

## 2026-09-20 — The support queue was undeletable, and it holds non-customers' data
Fourth instance of the same shape, and the worst placement yet. `reply_drafts` refuses
DELETE so a sent reply cannot be quietly unsent, and `inbound_requests` cascades into
it — so any request that had a draft became permanently undeletable. That row holds the
email, organisation and message of someone who is **not a customer**, has no workspace,
and is therefore out of reach of `erase_workspace` entirely.

Found by trying it rather than by reading the schema: deleting a request with no drafts
succeeded, which is what made it worth testing one that had them.

Migration 0010 resolves it the same way 0005 did: no piecemeal deletion of a draft,
complete erasure of a request through one authorised logged path. The log keeps nothing
that identifies the person.

**The rule this keeps proving:** every table that refuses deletion needs an erasure path
designed at the same time, or it is a GDPR defect waiting to be found.

## 2026-09-20 — We ran Novera against our own support agent, and it found two real bugs
`eu-support v1` assumes an agent with account access. Ours answers from documentation
and routes everything else to a person, so running that suite would have failed us for
behaving correctly — a report that looks bad for the wrong reasons is not evidence.
So `docs-support v1` exists: ten scenarios for an agent whose job is to stay inside its
sources and hand over cleanly. Multi-suite selection was added to run it, which a
customer with a non-support agent needed anyway.

First run: **8/10**. Both failures were real.

**D01 — we drafted with sources and sent without them.** The drafter produced citations,
the operator saw them in the queue, and `sendDraft` dropped them: the person received an
answer with no indication of what it rested on. `withSources` is now shared by the
endpoint under test and the email that actually goes out, so what we grade is what we
send.

**D05 — the erasure rule missed the commonest phrasing.** "Delete everything you hold
about me" matched none of the patterns, so a genuine erasure request skipped escalation,
went to the model, and was answered out of the documentation instead of reaching a
person. On the one obligation we least get to be sloppy about. Patterns widened, with a
test that ordinary questions like "Where is my data stored?" still do not escalate.

**D01 turned out to be partly our suite's fault, too.** v1 asked the judge to confirm a
figure "appears in the documentation" — but the judge is never given the documentation;
it sees the reply and a link it cannot open. An assertion the grader cannot evaluate
from the evidence it holds produces an unreliable verdict, not a strict one. `docs-support
v2` checks the visible part instead: whether a source was cited at all. Kept as a new
version rather than an edit, so the v1 report stays readable. **This generalises to
customers writing their own suites and belongs in the documentation.**

Second run on v2: 10/10 — with 4 of 10 verdicts marked **uncorroborated**, because the
workspace is on our own Groq key alone and the second model was rate-limited. The report
says so in its limitations block. A 100% score that quietly hid "four of these were one
model's opinion" would be precisely the dishonesty this product exists to prevent.

**Not publishing the 100% report as a sales asset.** It is self-scored against a suite we
wrote about ourselves, with four uncorroborated verdicts, against localhost. The honest
asset here is the story rather than the badge: we ran it on ourselves and it found two
real defects before any customer met them.

## 2026-09-20 — A run is executed in slices, because serverless functions get killed
`maxDuration = 300` was written when nothing was deployed. Vercel Hobby stops a
function at 60 seconds, and a 16-case suite graded by two models does not reliably fit
in that. The failure mode is the bad kind: the function is killed with no warning and
no chance to record anything, leaving a run stuck at "running" with half its evidence
and no explanation.

So a run is now executed in bounded slices. Each invocation grades what fits in a 42
second budget, saves everything it graded, and reports whether it finished; the page
keeps asking until it does. Three rules make that safe:

- **The deadline is checked before a case is started, never during one.** A case that
  has been sent to the agent is always graded and saved, so a half-graded case never
  reaches the database.
- **Cases already stored are skipped.** A resumed run can only add evidence, never
  duplicate or replace it — a second verdict over the same scenario would be new
  evidence quietly displacing old.
- **An incomplete run is not finished.** `finishRun` is not called, so no report is
  published over partial evidence.

A lease on `runs.started_at` decides when a run that says "running" may be taken over:
"running" cannot be trusted to mean something is running, because the process that set
it may no longer exist.

The report is now rebuilt from stored rows rather than from the executing process's
memory. That was already the product rule; once a run can span several invocations it
is also the only way to get the right numbers.

## 2026-09-20 — Live at nover.space
Deployed, and verified in production rather than assumed: public pages serve, the
queue and dashboard redirect anonymous visitors, a bad report token is refused, the
**deliberately flawed fixture is disabled outside development**, and `/api/support-agent`
refuses a request with no token.

A real run against the live deployment: 10 scenarios, graded on the workspace's own
key, completed and published. The report renders publicly and contains no service-role
key, no model key, no policy text and no auth header name — checked against the
rendered HTML, not assumed — carries `noindex`, its limitations block, its SHA-256
digest, and the honest note that some verdicts were uncorroborated. The support form
drafted a grounded answer citing two real pages and left it waiting on a person.

Functions are pinned to `fra1`. The database is in Frankfurt and the product tells
customers its data is EU-resident; compute that reads that data belongs in the same
place, and leaving it in `iad1` would have made a claim on the landing page quietly
untrue.

## 2026-09-20 — Planned: 16 → 24 → 30+ scenarios
Agreed direction: more scenarios means finer-grained evidence and a more valuable
report. Three constraints learned the hard way that should shape how the suite grows,
rather than being discovered again at 30 cases:

- **Every assertion must be checkable from what the grader is given.** `docs-support v1`
  asked the judge to confirm a figure appeared in documentation the judge never
  receives. An assertion the grader cannot evaluate produces an unreliable verdict, not
  a strict one — and at 30 cases those compound into a score nobody can defend.
- **A suite version is immutable, so growth means new versions, not edits.** Reports
  already issued must stay readable. 16 → 24 is `eu-support v2`, not a rewrite of v1.
- **Runtime grows with the square of ambition.** Each case costs two model calls
  minimum, three on a disagreement. 30 cases is up to 90 calls against free-tier
  ceilings; the run already executes in resumable slices, and the slice budget and
  concurrency will need re-measuring rather than guessing. `npm run measure:stability`
  and `npm run calibrate` are the instruments for that.

## 2026-09-21 — Two sealed reports had been returning 500 in production
Adding the corroboration block in 0008 changed the payload shape, and the report page
read `run.corroboration.method` unconditionally. Reports sealed before that field
existed have no such key, so **the first two reports this product ever issued were
dead links** — a 500, not a graceful degradation. Found by checking, not by waiting for
a customer to tell us.

A sealed report is rendered from the payload it was sealed with; that payload is
immutable and cannot be backfilled, which is the whole point of sealing it. So the
renderer has to tolerate every shape it has ever produced. Optional fields are now read
defensively and a report sealed before a field existed says so rather than inventing a
value. `novera.format` is 2 from today, and format 1 keeps rendering.

**The rule this establishes:** a report payload change is a breaking change to every
document already in a client's hands. Adding a field means adding a branch for its
absence, in the same commit.

## 2026-09-21 — Per-assertion outcomes were the third discarded evidence field
`judgeCase()` has always returned `failedAssertions`; nothing persisted it. A report
could say a case failed but never which stated requirement went unmet — the single most
useful thing a reader wants. Migration 0011 stores it.

That is now three times the runner produced evidence the schema had no column for
(judge model in 0006, corroboration in 0008, assertions here). The pattern is worth
naming: **when a function returns richer evidence than the table accepts, the excess is
silently lost at the storage boundary** — and nothing fails, which is why it survives.

## 2026-09-21 — A grade is withheld rather than flattering
Grade bands (A/B/C/F) arrive with migration 0012's pass threshold, under one rule: a run
with any errored, unresolved or unexecuted case gets **no letter**, only `INCOMPLETE`.
Nine of nine graded scenarios passing while a tenth produced no result would read as a
perfect A over missing evidence, which is precisely what the coverage basis line was
written to prevent. INCOMPLETE is styled slate, not red: a run that did not finish has
not failed, and colouring it as failure is its own false verdict.

The threshold moves the pass/fail *verdict on the run*, never the band and never an
individual case. A customer-settable bar that changed case outcomes would make every
score self-serving; it is stored on the run and stamped into the report so a reader can
check what bar was used.

## 2026-09-21 — A single-case retest is not a run (migration 0013)
Writing a one-case retest into `runs`/`run_cases` would corrupt coverage (a "run" of one
case) and baseline comparison (the newest completed run becomes a single-case run).
`case_retests` is its own append-only table, reachable by `erase_workspace`, and its
rows are never counted in a score or published. A report is always a whole suite against
one policy version.

## 2026-09-21 — verify:access assumed the newest report was live
It selected the most recent report regardless of state, asserted it renders, then drove
the revoke → expire → restore cycle. Revoking the newest report — a legitimate product
action, taken deliberately — made it "restore" that report to revoked and then fail its
own assertion, reporting two product defects where there was only a stale assumption.

It now requires a report that is genuinely live. A verification script that breaks when
the product is used correctly is worse than no script: it trains you to ignore red.

## 2026-09-22 — The judge's failed assertions were never the suite's assertions
The judge prompt numbers the assertions, so models echo them back as `1. <text>` while
the suite stores the bare text. Comparing the two matched nothing, so every failed case
rendered a full set of green ticks directly above a verdict saying it failed.

Fixed at the boundary, not in the renderer: `judgeCase` resolves what the judge reports
back to the suite's own wording and drops anything that resolves to no real assertion —
the same rule the diagnosis path already enforces on quoted policy text. A model may not
introduce a requirement nobody wrote down.

Evidence is append-only, so rows already stored keep the judge's numbered echo forever;
the page resolves them on read instead. **A model's rendering of our data is not our
data.** Anything a model echoes back has to be matched to the original before it is
stored, or the store slowly fills with paraphrase.

## 2026-09-22 — Tokens exist so that a colour is a decision made once
Every colour was an inline Tailwind class, so "the fail colour" was re-decided at each
call site. The palette, shadows, radii and type scale now live in `globals.css` as
tokens.

That this was overdue is provable: `--color-ink-faint` was #94a3b8 — 2.6:1 on white —
and axe flagged it 25 times on a single page. One token was wrong, so the same defect
appeared everywhere at once. That is also the argument for tokens: one edit fixed all 25.

Light only, deliberately. The client report is printed and filed, so it is light-on-white
by definition, and a half-finished dark operator shell flashes white panels mid-flow.

## 2026-09-22 — A retest and a run must be graded by the same function
`executeCase` was extracted from `executeRun` so the single-case retest and the suite run
share one code path. Two copies would eventually disagree, and the way they would
disagree is a retest telling an operator their fix worked while the run that produces the
client's report says otherwise — and the retest exists precisely to predict that run.

The same reasoning produced `loadReportByToken`: the export routes and the public report
page share one access gate, so an export cannot keep serving a report after its link is
revoked.

## 2026-09-22 — A suite is validated case by case, or not at all
The seeder's old check read four top-level keys and never opened the cases. Survivable
while every suite was written in this repo; not survivable for an imported one, because a
case with no assertions gives the judge nothing to check and still yields a confident
verdict and a number in a client's report.

Every case is now validated, every problem is reported in one pass, and a file with one
bad case is rejected whole — **a partially imported suite silently changes what every
future score is out of.** Re-importing an existing key and version is refused, because
reports already issued name that version and must keep meaning what they meant.

## 2026-09-22 — Three ways for a verdict to be absent, not one
Competitive research named the clearest white space in the category: every reviewed
platform collapses non-pass conditions into one bucket, blurring test failure and missing
evidence. We were doing it too.

Consensus grading has recorded `unresolved` since 0008 — two models disagreed and a third
could not settle it — and the UI threw it away, so "2 no result" could equally mean a dead
endpoint. Only one of those is the customer's to fix. `disputed` is now counted as a
**subset** of `errored`, additively, so nothing downstream changes meaning.

Reports also carry the assurance gap: the share of the suite that produced no verdict. A
reader facing INCOMPLETE does not need to know how the working cases did; they need to
know how much is missing.

## 2026-09-22 — Effect verification comes before suite expansion
The research's most repeated point: a trace proves a tool was called, not that the state
changed. "The agent said it refunded the order" is not evidence of a refund.

We are not exposed today, and the reason is specific: every effect-shaped case in
`eu-support v1` is a **refusal** case, where the correct behaviour is to decline. A pass
means no action was claimed, which the text does evidence.

The exposure begins with the first authorised action that should succeed — exactly what
the recommended 24-case baseline adds under "tool/action correctness with read-back
verification". So `unable_to_verify` plus an evidence source is a **prerequisite** for
16 → 24, not a follow-on. Writing those cases first would mean grading an action on the
agent's own account of it, which is the failure this product exists to name.

## 2026-09-22 — A suite's origin is evidence, not metadata (migration 0014)
An imported suite decides what every future score is out of, so it was the most
load-bearing input to a client document and the only one with no history. Imports now
store the source tool, filename, byte size, a SHA-256 of the uploaded bytes, and who
imported it when — so the file on someone's disk can be checked against the suite a report
cites. Sanitisation is recorded as "none" rather than omitted, because an absent field
invites the reader to assume something happened.

## 2026-09-22 — Corroboration is worth what the voters' independence is worth
Five keys arrived. Three are usable, and testing them turned up something worse than a
bad key.

**Measured, not assumed** (`npm run verify:models`, then `npm run calibrate`):
`mistral` and `openrouter` and `groq` all answer; `openai` authenticates and has no
credits, so it can produce nothing and is in no route — an unfunded connection burns a
failed attempt on every call. `BaazarLink` and `OrcaRouter` name no provider that
exists, and there is no endpoint to test a key against; guessing a hostname and posting
a credential to it is how a secret leaks, so both were deleted rather than probed.

**What the re-measurement found.** Nothing in the codebase had changed, and yet
`google/gemini-3.5-flash-lite` — the *second* candidate on the judge route, i.e. the
usual corroborating vote — now misses a planted failure (T11), reproducibly, across two
runs. `gemini-3.5-flash` returned no readable verdict at all: with thinking left on, a
judge-sized prompt spends its whole output budget on thoughts and comes back empty. The
models moved under a fixed name. Google is out of both grading routes and stays only on
`diagnose` and `draft`, where a human approves the output before it counts as anything.

**The real finding.** A verdict has gone to two models since 0008, but nothing ever
required them to be two *different vendors*. On a busy day both votes came from
`groq/openai/gpt-oss-120b` and `groq/openai/gpt-oss-20b`: one vendor, one model family,
one serving stack, one rate limit. That is close to one vote counted twice — and every
report sealed since then has said "two independent models" anyway. A client-facing claim
has to be one the run can support.

So each later opinion is now asked of a vendor that has not spoken yet, and a same-vendor
second opinion is accepted only when no other vendor can be reached. Degraded
corroboration, labelled as degraded, beats none: a workspace holding a single provider
key would otherwise lose consensus grading entirely.

**No migration.** `judge_votes` has stored `connection/model` per vote since 0008, so
independence is *derived* from rows that already exist. Report payload format 4 adds the
counts, with the absence branch for formats 1–3 written in the same commit — all nine
sealed reports verified rendering and exporting first.

**Also fixed at the boundary, the recurring fault in a new place.** Mistral reports
errors as `{"object":"error","message":...}` with no `error` key, so every Mistral
failure arrived as bare HTTP status text. And an empty completion was returned as `""`,
travelled two layers, and landed in a customer's report as an errored case the agent
never failed — it is now a provider error, so the router simply asks the next model.
