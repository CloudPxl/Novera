@AGENTS.md

# Project Novera

A one-person-operable SaaS, built by the user + Claude, on a near-EUR 0 budget, for the
European market. Base model: Nate Herk's "Agent Report Card" business framework.

**What it does:** runs a versioned scenario suite against a customer's live AI support
agent and emits a dated, hash-sealed **conformity report** — per-case evidence mapped to
the EU AI Act / GDPR duties the customer already has to document.

**Why that framing:** "agent testing" is a nice-to-have; conformity evidence is recurring
and urgent.

> The winning product is not the one with the largest score. It is the one a customer can
> defend in front of an auditor, a procurement team or an incident reviewer.

**This file is orientation, not history.** Every decision, with the reasoning and the
measurement behind it, is in `docs/DECISIONS.md` in dated order. The current plan is
`~/.claude/plans/this-is-project-novera-shiny-yeti.md`.

## Non-negotiable product rules

Load-bearing: the product's value *is* that its output can be trusted.

- Scores and counts are computed from stored run rows. Never invent, estimate or backfill
  a result.
- Errored and unexecuted cases are counted separately and never as passes.
- A fixture is never displayed as a real external action. Label test data as test data.
- draft / approved / sent (and draft / published / executed) are distinct persisted
  states. Never collapse them.
- Customer model API keys are encrypted at rest, server-side only, and must never appear
  in client bundles, logs, reports or screenshots.
- Novera is evidence of testing, not a legal certification. Every report carries an
  explicit scope-and-limitations block. Do not write compliance-guarantee copy.
- Only agents the customer owns or is authorised to test. The attestation is stored with
  the run.
- Nothing customer-facing ships without the user's explicit approval: no outreach sent,
  no public deploy, no published pricing.

## What the product guarantees, and what enforces it

Each line is a claim the report makes. The migration beside it is why the claim survives
someone with the service role, not merely someone using the application.

| Guarantee | Enforced by |
|---|---|
| Evidence is append-only — a verdict cannot be edited or deleted | `refuse_mutation()` triggers; erasure only through `erase_workspace()` |
| An errored case cannot be a pass; an evidence gap cannot sit on a verdict; a rule-settled case cannot name a judge | 0019 |
| A run's inputs were declared *before* it executed — suite version and case ids in order, policy version, agent host, judge plan, pass mark, runner version, rubric digest | 0016, frozen by trigger |
| A report was not edited after sealing, and chains to the previous report for that agent | SHA-256 content hash + `previous_report_hash` |
| A policy version is immutable; editing creates a new one | 0001 + append-only trigger |
| A diagnosis is a proposal: the model cannot quote policy text that is not in the policy, and a proposal whose target moved is refused rather than applied nearby | 0007 |
| A drafted scenario cannot enter a suite without a named approval, and cannot be withdrawn once it has | 0022 |
| A destructive or fixture-only scenario never runs against a production agent | `agents.is_production`, checked in the runner |
| A support reply goes draft → approved → sent, forward only; editing writes a new draft | 0009 |
| A public form cannot be made free | 0024, counted in Postgres |
| A workspace key grades only on models it was proved to reach, and one it cannot reach refuses the run rather than erroring every case | 0025 + 0026, route built from the key |
| A person's finding sits beside a verdict and never replaces it; it needs a reason, freezes the verdict it read, and cannot be filed against another workspace's case | 0028 |
| A review reaches a client only as a *new* sealed report that carries the original unchanged, names it by hash, and labels the reviewers as the tested party — never as a changed score | `src/lib/report/reissue.ts`, format 11 |

**A verdict is the finding of two models from different vendors.** A single judge drifted
on 25% of scenarios re-grading byte-identical responses, which the comparison reported to
the operator as fixes and regressions that never happened. Temperature 0; a third model
settles a disagreement; an unsettleable disagreement is an error, never a guess. Measured
25% → 6.3% by `npm run measure:stability`. Independence is derived from `judge_votes`, so
a same-vendor second opinion is reported as exactly that.

**The route is ordered by measured false passes, and that order is load-bearing.**
Consensus takes its second opinion from the first candidate of a *different vendor*, so
the first two entries are the pair that will grade almost every case. Until 2026-09-24
those two were the only two models with a measured false pass — on the same critical
scenario. Two models agreeing on a false pass is the one failure consensus exists to
prevent, so calibration is not advisory: it decides the order.

**A verdict has three ways to be absent, not one:** errored, `disputed` (two models
deadlocked, a third could not settle it), and unexecuted. Reports carry the **assurance
gap** — the share of the suite that produced no verdict.

**Evaluation order is cheapest-sufficient: rules → read-back → models.**
A scenario's checks (contains, matches, tools allowed/forbidden/required/ordered,
arguments excluded, no retry after failure, approval before an action, latency) can
**fail a case and can never pass one** — passing "must not contain X" says nothing about
whether the expectation was met. Then the read-back, if the agent has one. Only what is
left goes to models. A rule-settled case records `settled_by = deterministic` and carries
no judge, no votes, no agreement.

**A claimed action is not a verified one.** A scenario may declare an `effect` and what
would count as proof (`tool_invoked` or `state_confirmed`). Three outcomes from the
read-back: confirmed, contradicted (a failure settled without asking a model — the
strongest finding this product makes), unavailable (withheld, and a different gap from
having no read-back configured). GET only by construction, the path cannot escape the
configured origin, the credential has its own revocable scope, and the response body is
never stored.

**Coverage is three numbers** — execution, resolution, evidence — each `null` rather than
0 or 100 when the run carries nothing to compute it from. `WITHHELD` means everything ran
and the evidence does not support a letter; `INCOMPLETE` means scenarios never ran. Rerun
the suite, versus fix what made the evidence unusable.

**An attack has a channel.** A scenario may declare `context` — what the agent is told
*about* a conversation rather than by the customer — and an indirect injection is
delivered there. An agent with nowhere to receive it is recorded as an error, never sent
the attack in its message instead: that would be a different test under the same name.

## Stack and layout

Next.js 16 (App Router, `src/`, TypeScript) · Tailwind 4 · Supabase (Postgres + auth +
RLS, **Frankfurt / eu-central-1**) · Vercel Hobby, functions pinned to `fra1` · Resend.
Judge funding is hybrid: our free-tier key for trials, the customer's own key otherwise —
and **a workspace with its own key is graded on that key alone**, because the report
states who funded the grading. That key's route is built from the models the customer
named and we proved, not from `DEFAULT_ROUTES`, which names *our* connections: pairing
the two errored every case for three of the four providers the form offers. One model
is reported as not corroborated, two from one vendor as corroborated within one vendor,
and the settings page says which before the key is connected.

**Next.js 16 is newer than training data.** Read the relevant guide under
`node_modules/next/dist/docs/` before writing route handlers, server actions, caching,
params or proxy code. It is `proxy.ts` exporting `proxy`, not `middleware.ts` — that
rename is exactly the kind of thing recalled conventions get wrong.

```
src/app/(app)/        operator routes, behind one shared top bar + skip link
src/app/report/       the client's artifact — outside (app); its reader is not an operator
src/app/api/          route handlers
src/proxy.ts          security headers + nonce CSP
src/lib/agents/       adapters, probe, trajectory, response-path discovery
src/lib/runner/       execution, slicing, case orchestration
src/lib/judge/        consensus, checks, effect rule, independence
src/lib/evidence/     coverage, grade, read-back connectors
src/lib/report/       payload, build, hash, export, language rule
src/lib/scenarios/    the duty-to-test compiler
src/lib/support/      public forms, drafting, escalation, throttle, size limits
src/lib/docs/         the documentation renderer — parsed, never markup
supabase/migrations/  schema + RLS; every table's erasure path ships with it
data/suites/          versioned scenario suites + calibration labels
data/docs/            the published documentation, seeded into the database
docs/DECISIONS.md     append-only decision log — the reasoning behind everything here
docs/COMPETITION.md   the market, what we took, what we declined
```

**Design tokens live in `src/app/globals.css`** — palette, shadows, radii, type scale.
Use them; never reach for a raw Tailwind palette step. Two defects came from ignoring
this, both invisible to inspection: a severity chip at 2.82:1 contrast on the client's
report, and a transparent tooltip that still occupied layout and pushed every page using
one 28px past a 390px viewport.

**Measure the interface, never inspect it.** Every accessibility defect found in Phase 6
was invisible to reading the code *and* to looking at the page: a list whose items were
wrapped in a `<div>` and stopped being a list, a dropdown announcing itself as a menu it
did not implement, a hint paragraph no screen reader ever reached, and fifteen blocks
left permanently at opacity 0 by one jump to the footer. axe-core at 390 and 1440, plus
an overflow check, on every surface touched.

## Commands

Scripts run with `--conditions=react-server` so `server-only` resolves to its no-op.

| Command | What it proves | Cost |
|---|---|---|
| `npm test` | 373 unit tests | free |
| `npm run migrate` · `seed:suites` · `seed:docs` | schema, suites and docs are current | free |
| `verify:db` · `verify:access` · `verify:tenancy` | append-only, RLS, erasure, cross-tenant isolation | free |
| `verify:byok` | the trial cap, and that our keys are never a silent fallback | free |
| `verify:effect` · `verify:channel` · `verify:compiler` | evidence rules, the metadata channel, the compiler's refusals | a few model calls |
| `verify:throttle` | the public forms cannot be made free | free |
| `verify:models` | every route candidate still answers | a few tokens |
| `demo:run` (`DEMO_SUITE_VERSION=4`) | the whole loop, end to end, publishing a report | a full run |
| `calibrate` (`CALIBRATE_SUITE=…`, `CALIBRATE_CASES=T37,…` for a subset, never stored) | judge quality and drift against ground-truth labels | **real quota — pace it** |
| `measure:stability` | verdict instability on identical responses | real quota |

`npm run dev` must be running for `verify:effect`, `verify:channel` and `calibrate`:
they drive the scripted fixture at `/api/test-agent`.

## Working agreement

- The user reviews and approves; Claude writes the code and hands back numbered,
  copy-pasteable checklists for anything to be done outside this window.
- Commit at each milestone, append one line to `docs/DECISIONS.md`, and refresh this file
  when the shape of the project changed.
- **Claim something works only when a command, a test or a stored row shows it.** Report
  failures with their output.
- Documentation is part of what a phase ships. `/docs` is what the support agent answers
  from, with citations — a stale page produces confident, sourced, wrong replies.

## Rules learned the hard way

- **A report payload change breaks every document already in a client's hands.** An added
  field ships with its absence branch in the same commit. Two reports were returning 500
  in production before this was caught. 16 sealed reports now span payload formats 1–11.
- **A model's rendering of our data is not our data.** The judge echoed assertions back
  with the numbering the prompt added; storing that verbatim made every failed case render
  as fully passing.
- **Every table that refuses deletion needs an erasure path in the same migration.**
  Learned seven times.
- **Route tables rot silently.** Nothing changed in the codebase and `gemini-3.5-flash-lite`
  started missing a planted failure; `gemini-3.5-flash` stopped returning a readable
  verdict at all. Google is out of both grading routes and stays on `diagnose` and
  `draft`, where a person approves the output.
- **When a capability lands on one run path, the other is not the old path** — it is a
  second product with the same name. `startRun` graded without a read-back for a week
  while `startRunExecution` had one, and later stamped runs `workspace_key` while
  grading on our own env keys. Both now resolve credential, route and attribution from
  one call.
- **A verification that exercises one value out of four proves one thing.** `verify:byok`
  tested the one provider that happened to be in the route table for a month.
- **One name meaning two things at a boundary** has now cost eight debugging sessions.
  `assertions`, `observation`, `context`, and a documentation `body` that was Markdown
  going in and plain text coming out — if a field means one thing on each side, rename
  one of them.
- **A refusal has to be in the shape its caller reads.** A route handler that redirects
  an unauthenticated caller hands `fetch` a 200 and an HTML page; the run page read that
  as success and sat at "running" in silence.
- **A page must not render a sentence a stranger supplied.** `/sign-in?problem=` printed
  whatever arrived inside Novera's own alert box, on the page that asks for a password.

## Open questions and known limits

- **Price is undecided.** `docs/COMPETITION.md` holds the anchors and the argument for
  pricing a verified run rather than model calls. Nothing is published.
- **Two grading vendors, not three.** The OpenAI key authenticates but has no credits, so
  it is in no route. Independence currently means groq + mistral; a funded key is the
  cheapest way back to three.
- **Free-tier ceilings:** Groq 8,000 **tokens** per minute (not requests), Mistral about
  one request per second, Google's daily quota exhausted by a couple of calibration runs.
  Consensus doubles judge calls, so throughput is the thing to measure before promising
  concurrent customer runs. A full 36-case v3 run measured 27 seconds with four rate
  limits absorbed by fallback and no case lost.
- **A judge key stored before 2026-09-24 has no models recorded**, so it falls back to
  whatever `DEFAULT_ROUTES` measures on that connection — which is groq only. Any other
  provider's legacy key refuses the run with a sentence saying to reconnect it.
- **`_dmarc` TXT record is not set.** Signup works end to end in production, but the
  Resend key is send-only, so inbox *placement* is unproven.
- **`eu-support v4` has not had a full calibration sweep.** Its five new scenarios were
  measured on the four route judges (20 of 20 agreed with the labels); T01–T36 are
  byte-identical to v3, whose sweep is the current measurement.
- **Runs execute in resumable 42-second slices** because Vercel Hobby kills a function at
  60. The deadline is checked before a case starts, never during one; an incomplete run is
  never finished, so no report is published over partial evidence.
