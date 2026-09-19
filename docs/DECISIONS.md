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
