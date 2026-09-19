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
Phase 1 in progress. Built and under test (`npm test`): the 16-case conformity suite
(`data/suites/`), the schema with append-only evidence (`supabase/migrations/`),
coverage and comparison arithmetic, report hashing and the pre-publish leak guard,
three model providers, the judge, and both agent adapters.

Next: the run orchestrator behind a storage interface, then the Supabase
implementation of it, then the UI. Phase 1 is done when the full path runs —
connect -> probe -> policy version -> run -> grade -> inspect -> diagnose ->
approve v2 -> rerun -> compare -> report — and passes the plan's acceptance criteria.

Blocked on the user: Supabase project (Frankfurt), GitHub repo, Vercel account.
