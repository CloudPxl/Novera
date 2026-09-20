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
`npm run migrate`, `npm run seed:suites`. Scripts run with `--conditions=react-server`
so `server-only` resolves to its no-op. `npm test` — 73 passing.

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

Remaining: decide a price. Planned: grow the suite 16 → 24 → 30+ as new versions
(see DECISIONS for the three constraints that should shape it).

Free-tier ceiling worth remembering: Groq is 8,000 tokens/minute and consensus grading
doubles the judge calls, so the router falls through to Google mid-run more often than
before. Runs still complete with zero errors, but throughput is the thing to measure
before promising concurrent customer runs.
