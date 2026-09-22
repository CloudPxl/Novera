@AGENTS.md

# Project Novera

A one-person-operable SaaS, built by the user + Claude, on a near-EUR 0 budget, for
the European market. Base model: Nate Herk's "Agent Report Card" business framework.

**What it does:** runs a versioned scenario suite against a customer's live AI support
agent and emits a dated, hash-sealed **conformity report** — per-case evidence mapped
to the EU AI Act / GDPR duties the customer already has to document.

**Why that framing:** "agent testing" is a nice-to-have; conformity evidence is
recurring and urgent. See `docs/DECISIONS.md` for every decision behind this.

## Non-negotiable product rules
These come from Nate's pack and are load-bearing here — the product's value *is* that
its output can be trusted.
- Scores and counts are computed from stored run rows. Never invent, estimate or
  backfill a result.
- Errored and unexecuted cases are counted separately and never as passes.
- A fixture is never displayed as a real external action. Label test data as test data.
- draft / approved / sent (and draft / published / executed) are distinct persisted
  states. Never collapse them.
- Customer model API keys are encrypted at rest, server-side only, and must never
  appear in client bundles, logs, reports or screenshots.
- Novera is evidence of testing, not a legal certification. Every report carries an
  explicit scope-and-limitations block. Do not write compliance-guarantee copy.
- Only agents the customer owns or is authorised to test. The attestation is stored
  with the run.
- Nothing customer-facing ships without the user's explicit approval: no outreach
  sent, no public deploy, no published pricing.

## Stack
Next.js 16 (App Router, src/, TypeScript) · Tailwind 4 · Supabase (Postgres + auth +
RLS, **Frankfurt / eu-central-1**) · Vercel Hobby · Resend free tier.
Judge model funding is **hybrid**: our free-tier key for trial runs, the customer's
own key for paid workspaces.

**Next.js 16 is newer than training data.** Read the relevant guide under
`node_modules/next/dist/docs/` before writing route handlers, server actions, caching
or params code. Do not rely on recalled Next conventions.

## Layout
```
docs/THREE-PS.md      pain / person / promise; hypotheses marked UNVERIFIED
docs/DECISIONS.md     append-only decision log
docs/COMPETITION.md   who else is here, what we took from them, what we declined
.env.example          empty template; real values only in .env.local + Vercel
src/app/              routes
src/lib/              runner, judge, report, supabase clients
supabase/migrations/  schema + RLS
data/suites/          versioned scenario suites
```

## Working agreement
- The user reviews and approves; Claude writes the code and hands back numbered,
  copy-pasteable checklists for anything that must be done outside this window.
- Commit at each milestone, then append one line to `docs/DECISIONS.md` and refresh
  this file if the shape of the project changed.
- Claim something works only when a command, test or stored row shows it. Report
  failures with their output.

## Status
**The loop is closed and the operator can drive it.** Connect an agent → probe receipt
→ policy version → run the suite live → inspect a failure → ask why it failed →
approve the proposed change as a new policy version → rerun → compare. Verified in a
real browser against the live database, not by inspection.

**A verdict is the finding of two models, not one.** A single judge was measured
drifting on 25% of scenarios when re-grading byte-identical agent responses, which the
comparison had been reporting to the operator as fixes and regressions that never
happened. Grading is pinned to temperature 0 and every verdict goes to two independent
models, with a third to settle a disagreement; an unsettleable disagreement is an
error, never a guess. Measured 25% → 6.3% instability by `npm run measure:stability`.
A report states how many verdicts agreed, how many a third settled, and how many could
not be corroborated.

**A diagnosis is a proposal, never an edit.** The model may not quote policy text that
is not in the policy, and a proposal whose target has since moved is refused rather
than applied nearby. Migration 0007 freezes the analysis at insert and allows exactly
one recorded decision.

Working end to end: `npm run demo:run`, `npm run verify:db`, `npm run verify:access`,
`npm run verify:tenancy`, `npm run calibrate`, `npm run measure:stability`,
`npm run migrate`, `npm run seed:suites`, `npm run verify:models`, `npm run verify:effect`. Scripts run with `--conditions=react-server`
so `server-only` resolves to its no-op. `npm test` — 167 passing.

The artifact exists: `src/app/report/[token]/page.tsx`, verified to leak no key, no
policy text and no raw agent response, with expiry and revocation enforced.

A5 is built except for one external step. There is a real landing page, a signup that
lands on `/auth/confirm`, a settings page for the workspace's own model key, and a
trial capped at 3 runs. The cap is enforced in `src/lib/auth/entitlement.ts`, which
both run-creating actions ask, and proved live by `npm run verify:byok`.

**A workspace with its own key is graded on that key alone.** No silent fallback to
our free tier, because the report states who funded the grading and that statement has
to stay true. The cost is that a single-provider key has fewer places to fall back to,
so a rate limit becomes an errored case — reported as one.

Still blocking public signup: Supabase sends the confirmation email and has no SMTP
configured, so the link never arrives. That is a dashboard step, not code — verify a
domain in Resend, create an SMTP credential, paste it into Supabase Auth. Until then
accounts must be created with the admin API.

A6 is built: `/docs` (eight pages), `/support`, `/apply`, and a staff-only `/inbox`.
Support answers are drafted only from the published pages, only with citations to
slugs that exist, and only a person sends them — draft / approved / sent are enforced
forward-only by a trigger, and editing a draft writes a new one. Consequential
questions (money, personal data, contracts, security) escalate before a model is
called.

Dogfooded: `docs-support v1/v2` (10 scenarios for a documentation-grounded agent) run
against `/api/support-agent`, which exposes the real support pipeline rather than a copy
of it. The first run scored 8/10 and found two real defects — sent replies dropped their
citations, and the erasure rule missed "delete everything you hold about me". Both fixed;
v2 scores 10/10 with 4 verdicts marked uncorroborated because our own key has no
fallback, and the report says so.

**Live at https://www.nover.space** (apex redirects to www), functions pinned to
`fra1`. `vercel.json` pins the framework in code — the project was created with preset
"Other", which built Next.js correctly and then served the empty `public/` folder, so
every route 404'd while the build log looked perfect.

Verified in production: public pages serve, anonymous visitors are redirected off the
dashboard and queue, a bad report token 404s, the flawed fixture is disabled, a real
run completes and publishes, and the published report leaks no key, policy or header.

Runs execute in resumable 42-second slices because Vercel Hobby kills a function at 60.
The deadline is checked before a case starts, never during one; stored cases are
skipped on resume; an incomplete run is never finished, so no report is published over
partial evidence.

**The operator interface is the Agent Report Card Viewer.** Parts 1 and 2 of the
plan at `~/.claude/plans/this-is-project-novera-shiny-yeti.md` are done; Part 3 (the
post-launch roadmap) is not started.

Design tokens live in `src/app/globals.css` — palette, shadows, radii, type scale.
Use them; do not reach for a raw Tailwind palette step. The operator routes sit in a
`(app)` route group behind one shared top bar; the landing page, docs, support and
`/report/[token]` stay outside it, because a client opening a report link is not an
operator.

The run page is four tiers: grade scorecard, category grid, a filterable matrix of
every scenario with its assertion checklist and judge provenance, and a comparison
ribbon with a run-vs-run picker. A failing scenario can be diagnosed, the proposal is
shown as a diff, and one scenario can be retested on its own — `case_retests`, never
counted in a score and never published, because a report is always a whole suite.

Reports export as Markdown and CSV through the same token gate as the page, so an
export stops working the moment a link is revoked. PDF is browser print; the page
already prints correctly.

Suites can be imported (JSON or CSV) and are validated case by case by
`src/lib/suites/validate.ts`, which the seeder uses too.

Measured, not assumed: no page overflows at 390/768/1024/1440, and every page passes
axe-core at 390 and 1440. `npm test` — 167 passing.

Three rules learned the hard way and worth keeping in front of you:
- **A report payload change breaks every document already in a client's hands.** Adding
  a field means adding a branch for its absence in the same commit. Two reports were
  returning 500 in production before this was caught.
- **A grade is withheld, never flattering.** Any errored, unresolved or unexecuted case
  means `INCOMPLETE` and no letter.
- **A model's rendering of our data is not our data.** The judge echoed assertions back
  with the numbering the prompt added; storing that verbatim made every failed case
  render as fully passing. Match model output to the original before storing it.

**A verdict has three ways to be absent, not one.** Pass / fail / error was hiding a
distinction the database already stored: a case where two models deadlocked and a third
could not settle it is `disputed`, and it says something different about the agent from a
timed-out endpoint. Reports also carry the **assurance gap** — the share of the suite that
produced no verdict — because that is the number a reader needs beside INCOMPLETE.

**A verdict is only as independent as the models behind it.** Grading has gone to two
models since 0008, but nothing required them to be two *different vendors* — both votes
could come from one vendor's own model family, sharing a lineage, a serving stack and a
rate limit, while the report said "two independent models". Each later opinion is now
asked of a vendor that has not spoken yet; a same-vendor second opinion is accepted only
when no other vendor can be reached, and the report says which happened. Derived from
`judge_votes`, so every historical run can be described honestly without a migration.
Verified live: 16 of 16 verdicts corroborated across groq, mistral and openrouter.

**A claimed action is not a verified one.** A scenario may declare an `effect` — what is
supposed to change, and what would count as proof (`tool_invoked` or `state_confirmed`).
A pass is withheld when the evidence is not there and the case is recorded as `error`
with an `evidence_gap` (0015), never as a fault in the agent. A fail always stands.
`state_confirmed` is withheld in every case today because no read-back source exists yet
— which is the honest state of the product, now visible rather than hidden behind a pass.
This was the prerequisite for 16 → 24; those cases can now be written.

**Route tables rot silently.** Nothing in the codebase changed and yet
`google/gemini-3.5-flash-lite` — the second candidate on the judge route, the usual
corroborating vote — started missing a planted failure, reproducibly, and
`gemini-3.5-flash` stopped returning a readable verdict at all (its thinking spends the
whole output budget). Models move under a fixed name. Google is out of both grading
routes and stays only on `diagnose` and `draft`, where a human approves the output.
`npm run verify:models` checks every route candidate cheaply; `npm run calibrate`
re-measures grading quality and costs real quota.

Remaining: decide a price — `docs/COMPETITION.md` has the competitor anchors and the
argument for pricing a verified run rather than model calls. Two operational notes: the
OpenAI key authenticates but has no credits, so it is in no route; and `MISTRAL_API_KEY`
must be set in Vercel for production to grade across three vendors rather than two.

Free-tier ceilings worth remembering: Groq is 8,000 tokens/minute, Mistral's free tier is
about one request per second, and Google's free tier can be exhausted for the day by a
couple of calibration runs. Consensus doubles the judge calls, so throughput is the thing
to measure before promising concurrent customer runs.
