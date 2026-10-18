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

**V1 closed on 2026-10-13** (`docs/audits/2026-10-13-v1-final-audit.md`). V2 is fine-tuning (SEO
first, then speed, search content and polish) and the steps that wait on the legal entity:
`docs/V2-PLAN.md`.

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
| A run's inputs were declared *before* it executed — suite version, its SHA-256 suite digest (new runs) and case ids in order, policy version, agent host, judge plan, pass mark, runner version, rubric digest — and its evidence is only those scenarios, each recorded once, while it runs: a completed run takes no new row, and a run is marked completed only when every declared scenario has one | 0016, frozen by trigger; 0043; 0048 |
| A report was not edited after sealing, and chains to the previous report for that agent | SHA-256 content hash + `previous_report_hash` |
| Every report and export says it is testing evidence, not a certification, conformity assessment or notified-body approval — beside the sealed content, never inside it, so no hash changes | `src/lib/legal/notices.ts`, report page, `src/lib/report/export.ts`, `tests/ci.test.ts` |
| No paid plan starts without a business's details and an acceptance of the current legal texts, with the Civil Code art. 1203 clauses accepted separately; the record names each text's version and SHA-256, cannot be edited, stores no IP, never calls a VAT number validated, and leaves with its workspace (the 10-year accounting-retention gap this opens is with counsel: `docs/LEGAL-COUNSEL-QUESTIONS.md`); live billing also needs approved texts and complete company details, and a production deployment refuses a Stripe test key | 0068, `src/lib/legal/contract.ts`, `startCheckout`, `billingConfig`, `tests/legal-framework.test.ts` |
| A withdrawn report stays withdrawn, its link and exports refuse at once, and the row names who withdrew it; whether a report is ready to send is computed from the sealed document and never raised because someone wants to share it | 0053, `src/lib/report/readiness.ts`, `verify:db` |
| A policy version is immutable; editing creates a new one | 0001 + append-only trigger |
| A diagnosis is a proposal: the model cannot quote policy text that is not in the policy, and a proposal whose target moved is refused rather than applied nearby | 0007 |
| A drafted or imported scenario cannot enter a suite without a named approval, and cannot be withdrawn once it has; an import carries its file and item hashes, a policy draft its quoted passage, each frozen | 0022 + 0030 |
| A suite version cannot be changed or deleted once it exists, by anyone; a draft arrives undecided, whoever inserts it; a builder draft quotes its source word for word, and one resting on an open question cannot be approved until a person answers it | 0056, `verify:builder` |
| An exploratory scan of unapproved drafts is never a conformity report: only the Suite Builder starts one, it cannot be scheduled, and the database refuses it a report | 0056 `reports_not_exploratory`, `src/lib/workflow/start-run.ts` |
| A curated pack is eu-support v5 scenarios byte for byte, its quality record computed from the labels; a pack without measured scenarios is not offered; observed agent behaviour is never written as policy | `src/lib/builder/packs.ts`, `tests/builder.test.ts`, `verify:builder` |
| A sign-in never strands a person: a sign-up whose email could not be sent says no account was created, a reset never claims a link was sent over a mail failure, every emailed or provider link returns only to this deployment and to a fixed list of pages, Google and GitHub appear only when enabled, the last way in cannot be removed, and linking, unlinking, password changes and signing out everywhere are audited | `src/lib/auth/redirects.ts`, `src/lib/auth/errors.ts`, `src/app/auth/callback/`, `tests/auth.test.ts`; dashboard steps in `docs/setup/sign-in-and-email.md` |
| An emailed link signs in only the browser that asked for it: a `token_hash` confirmation confirms the address and starts no session, magic-link and invite links are refused, and a password reset needs a fifteen-minute, single-use recovery context set where a recovery link is spent — a bare `token_hash` reset is verified without cookies and never signs the browser in (its session travels sealed inside the context), and a PKCE code mints one only when GoTrue stamped the session `recovery` | `src/app/auth/confirm/route.ts`, `src/app/auth/callback/handle.ts`, `src/lib/auth/recovery.ts`, `tests/auth.test.ts` |
| A workspace with its own model key has all of its model work — grading, diagnosis, drafting, Suite Builder extraction, Ask Novera — served on that key, never ours, and each operation is recorded with funding, provider and model, never content; Ask Novera shows no figure its inputs do not contain | `src/lib/providers/model-work.ts` (`resolveConnections`), 0059, `tests/model-work.test.ts` |
| Billing truth comes from Stripe's signed webhook, each event handled once, never from the browser returning from Checkout; live keys are refused unless explicitly allowed; a plan sells only at its approved catalog price, checked against Stripe's before checkout; a deployment reads only its own Stripe mode's rows (preview and production share one database), so a sandbox subscription never shows, blocks erasure or blocks a live checkout; erasure is refused while Stripe could still charge; a subscription change never deletes evidence | 0060, 0065, 0066, `src/lib/billing/`, `tests/billing.test.ts`, `docs/BILLING-DECISIONS.md` |
| After the trial, a run starts only when a subscription or grant in force funds it, own key or not (D3), and the run names which, frozen; a plan's managed runs on Novera's keys are `plan_managed` (never called the trial) and counted against its period allowance; fair use on every plan — 3 runs in progress, 1,000 per 30 days — counted under a per-workspace lock however many starts race; every refusal names its kind and the place it is resolved | 0067, `resolveEntitlement` via `workspaceEntitlement` in `startRun`, `src/lib/billing/limits.ts`, `remedy.ts`, `tests/entitlement.test.ts`, `verify:byok` |
| A workspace export is owner/admin, one-time and short-lived, carries no token, secret or key hash, and leaves a receipt with its SHA-256 — never the file | 0061, `src/lib/export/`, `verify:export` |
| A stored agent or read-back credential never follows its address to another host: moving an agent to a new host needs the credential pasted again or removed, and a moved or removed read-back drops its credential | `parseConnectionEdit` (`src/lib/agents/connection.ts`), `saveVerificationEndpoint`, `tests/agent-connection.test.ts` |
| A destructive or fixture-only scenario never runs against a production agent; an agent is production until an owner or admin marks it a test target, confirmed and audited | `agents.is_production`, checked in the runner; `setAgentEnvironment`, 0057 |
| A support reply goes draft → approved → sent, forward only; editing writes a new draft | 0009 |
| A public form cannot be made free | 0024, counted in Postgres |
| Raw evidence — inputs, replies, transcripts — reaches an API or MCP caller only with the `responses` scope and when asked for, exactly as stored, and each such read is recorded with its key and route where members can see it; otherwise personal data a grader quoted is a placeholder, as in a report | 0050, `src/lib/api/read.ts`, `verify:api`, `verify:mcp` |
| The trial funds three runs per owner across every workspace they own, however many starts arrive at once, and a run start retried with the same `Idempotency-Key` returns the run it started instead of a second one | 0049, 0055, `src/lib/api/idempotency.ts`, `verify:api`, `verify:identity` |
| A person gets one workspace on first use, however many page loads race to create it, and may belong to several; the active one is a cookie checked against live membership on every request, never trusted, and every page reads only the active workspace | 0029, `src/lib/auth/session.ts` (`requireContext`), `verify:identity` |
| A member's role decides what they may do — owner, admin, operator, reviewer, auditor — checked against the live row by every server action; no client writes an agent, a scenario draft or a production failure directly, an agent's attestation and a draft's decision name their person once, and only the server spends a rate limit; drafting and approving are different roles; the owner cannot be removed or demoted, and nobody else is made owner | 0054, 0057, `src/lib/auth/permissions.ts`, `tests/permissions.test.ts`, `verify:identity` |
| An invitation works once, for its address only, for seven days, and stays revoked once revoked; removing a member takes effect on their next request and revokes the API keys they created there | 0054 `accept_invitation`, `remove_workspace_member`, `verify:identity` |
| Who changed who may do what — members, roles, keys, webhooks, retention, withdrawal, account mode, memory — is an append-only audit trail, read by owner, admins and auditors | 0054 `audit_events`, `src/lib/audit/record.ts` |
| A person's profile and preferences never reach grading, suites, policies or reports; assistant conversations are private to their person and expire after 180 idle days; assistant memory exists only by a person's action, refuses key-, link- and instruction-shaped values (also in the database), and a model's suggestion is stored only as a candidate the person accepts | 0054, `src/lib/assistant/memory.ts`, `tests/memory.test.ts`, `verify:identity` |
| Deleting an account erases the workspaces it owns, ends its memberships and keys elsewhere, deletes its profile, conversations and memory, and pseudonymises the sign-in so evidence elsewhere stays attributed to an id without personal data — except an attestation connected before 2026-10-16, whose frozen text names the attester's email; new attestations name a workspace role and user id (`src/lib/legal/attestation.ts`) | 0054 `erase_account`, `src/lib/workflow/identity.ts` |
| A row can refer only to rows in its own workspace — agents, policies, runs, cases, failures, suites (built-ins shared) — even for the service role | 0034 `refuse_cross_workspace()`, `verify:tenancy` |
| Every `/api/v1` write route reads at most 64 KB of body (256 KB for a production failure) and answers 413 past it, before parsing or counting; a stopped run's reason names a role and user id, never an email, because API and MCP keys read it | `src/lib/api/body.ts`, `src/lib/workflow/stop-run.ts`, `tests/api-body-limit.test.ts` |
| A run aborted before it recorded any scenario — stopped, superseded, halted before reaching the agent — spends no trial run, grant unit or managed run; fair use still counts every start | 0074 `counts_against_allowance(runs)`, `src/lib/billing/allowance.ts`, `tests/allowance-empty-abort.test.ts`, `verify:billing` |
| A pilot code is stored only as an HMAC under the server secret, redeemed once per owner by an owner or admin through one transaction that writes the grant, the redemption, the billing event and the audit line together (unknown, revoked and expired answer alike; 5 attempts per 15 minutes per person, workspace and hashed address); a code-redeemed pilot is one pool across every workspace its owner owns, counted by grant under the workspace-then-owner lock order, and the database refuses a run naming another owner's grant | 0075, 0076, `src/lib/billing/pilot-codes.ts`, `scripts/pilot-code.mts`, `tests/pilot-codes.test.ts`, `tests/pilot-owner-pool.test.ts`, `verify:billing` |
| An API key is stored only as an HMAC, reads by default, and starts runs or reads the agent's replies only if its creator chose that (never `run` or `responses` without `read`), cannot be altered, and once revoked stays revoked; a key reads only its own workspace, and a run it starts names it | 0033 + 0035 + 0052 + `src/lib/api/`, `verify:api` |
| An assistant on MCP is offered only its key's scopes; with `write` it can ask for scenario drafts and diagnoses, which land as drafts and proposals naming the key — no scope approves, publishes, revokes, changes a policy or sends | 0039, `src/lib/mcp/tools.ts`, `src/lib/workflow/propose.ts`, `verify:mcp` |
| A schedule starts a due run once however many ticks race, runs a pinned suite at a fixed UTC time, pauses with its reason when a run cannot start, and is never deleted — the runs it started name it; who started any run cannot be rewritten | 0036, `src/lib/schedules/`, `verify:schedules` |
| A model provider receives only the data class its published terms allow: support messages only where identifiable data is allowed, customer content redacted where only that is, nothing of the customer's to free tiers that train on it; where a grader read placeholders, the vote, the case and the report say so | `src/lib/privacy/data-class.ts` in the router, `tests/privacy.test.ts` |
| An agent's raw replies are kept only for the workspace's retention period (30–365 days, default 180); then the daily pass empties them and nothing else, leaving the verdict and a SHA-256 of the reply; a sealed report shows quoted personal data only as placeholders; a support conversation is erased 90 days after it last moved, and a probe receipt's reply emptied after 90 days | 0037 `expire_raw_evidence()`, 0038 `expire_inbound_and_probes()`, `verify:retention`; `buildReport` scrub |
| Novera calls only public addresses — an agent or read-back URL resolving to a private, loopback or metadata address is refused when saved and on every call, and redirects are reported, not followed; every agent and model call has a deadline inside the slice that also bounds reading the answer, every answer read is capped (agent and read-back 256 KB, model 1 MB) and a webhook receiver's is never read, and a run idle for 24 hours is stopped, never sealed | `src/lib/net/public-url.ts`, `src/lib/net/read-body.ts`, 0040, `verify:slices` |
| A customer's agent is paced (250 ms between sends) and an unreachable or rate-limiting endpoint is not a finding: HTTP 408/429/502/503/504 or no connection is a case error, never a fail, and three in a row halt the run (aborted, never sealed) with the reason — counted in send order, so a success sent before the failures began cannot reset the count while scenarios run in parallel; a reply's NUL or unpaired surrogate is stored as U+FFFD, never an aborted run | `src/lib/runner/execute.ts` (`AGENT_PACE_MS`, `isTransportFailure`), `tests/runner.test.ts` |
| An aborted run is never sealed — stopped by a person (even mid-slice), idle for 24 hours, or ended by a failure; a stopped run sends its agent no further scenario; at most two slices grade on the shared trial keys at once, and a third waits rather than degrading everyone's verdicts | 0041 `claim_run_slice`, `src/lib/workflow/stop-run.ts`, `verify:slices` |
| A webhook is signed (HMAC over timestamp and body), sent only to a public address, never follows a redirect, carries counts and links but no reply, input, policy or key, is queued once per run and endpoint, and cannot be edited after it is queued; each attempt is claimed by one sender and counted, and delivery is at least once (receivers deduplicate by `Novera-Delivery`), one broken endpoint never holding up another; an endpoint's secret is sealed and shown once | 0042, 0046, `src/lib/webhooks/`, `verify:webhooks` |
| A production failure is stored redacted — the original only as a hash — cannot be edited, and becomes a test only as a draft a person approves, linked to it for good; one sent through the API needs a `write` key, names it, and the same text twice is one record | 0031, 0044, `src/lib/regressions/record.ts` |
| Only the migration runner can read or change the migration ledger, which decides what runs: it is created closed, and the runner refuses a ledger any API role can reach rather than trust it | 0045, `scripts/migrate.mts`, `verify:db` |
| A workspace key grades only on models it was proved to reach, and one it cannot reach refuses the run rather than erroring every case | 0025 + 0026, route built from the key |
| A CI pipeline gets one run per commit, suite and language however often it retries (`POST /api/v1/ci/trigger`, started through `startRun`); a newer commit on the branch stops the older one's unfinished run, aborted and never sealed; the gate's exit code is the report's own (0–4, unchanged) | 0070 `ci_triggers`, `src/lib/ci/`, `tests/block5-ci.test.ts` |
| A suite extension is the official suite byte for byte plus at most five scenarios the workspace approved, refused by the database otherwise; the run records the base suite digest and a separate extension digest. A language variant lives beside a suite, never in it: base digests never move, a variant replaces only the input and any English text rule, and the run states how many scenarios were sent in which language | 0071, `src/lib/suites/extension.ts`, `src/lib/suites/locales.ts`, `tests/block5-extensions-locales.test.ts` |
| A single-scenario check is never a run: it writes no run, case, score or report and spends no run allowance, it keeps the production guard, and it is limited to 20 per workspace per hour, counted under a lock | 0072, `src/lib/workflow/scenario-check.ts`, `tests/block5-probe.test.ts` |
| "Test connection" stores nothing — no agent, no probe, no audit line — and goes through the same field parser, template, credential-follows-host rule and public-address guard as a saved agent's run; it is limited to 20 per workspace per 10 minutes. The sample agent is Novera's own scripted fixture, a test target from creation, and every report from it says test data; the fixture is served everywhere (scripted text, no model call, at most 64 KB read) unless a deployment sets `NOVERA_SAMPLE_AGENT=off`; one sample per workspace however many clicks race (0073) | `src/lib/agents/preflight.ts`, `src/lib/workflow/preflight.ts`, `src/lib/agents/sample.ts`, `tests/block6-onboarding.test.ts` |
| `/api/health` and `/status` name a status per component and nothing else — no counts, vendor names, errors or environment values; a client that disconnects mid-response is never reported as an error | `src/lib/observability/health.ts`, `benign.ts`, `tests/block6-ops.test.ts` |
| A person's finding sits beside a verdict and never replaces it; it needs a reason, freezes the verdict it read, and cannot be filed against another workspace's case | 0028 |
| The in-app assistant can link only to this workspace's own paths and offer only a run the person presses; it never attests, never sees keys or policy text, and refuses key-shaped input before any model call | `src/lib/assistant/core.ts`, tested |
| A review reaches a client only as a *new* sealed report that carries the original unchanged, names it by hash, and labels the reviewers as the tested party — never as a changed score | `src/lib/report/reissue.ts`, format 11 |

**A verdict is the finding of two models from different vendors.** A single judge drifted
on 25% of scenarios re-grading byte-identical responses, which the comparison reported to
the operator as fixes and regressions that never happened. Temperature 0; a third model
settles a disagreement; an unsettleable disagreement is an error, never a guess. Measured
25% → 6.3% by `npm run measure:stability`. Independence is derived from `judge_votes`, so
a same-vendor second opinion is reported as exactly that. A pass only one model gave — the
second could not be reached — is not corroborated: from format 13 the release gate (CLI,
exports, API `outcome`, webhooks, n8n) reads it as incomplete evidence, exit 2; older reports
keep their sealed codes (decision G5).

**The route is ordered by measured false passes, and that order is load-bearing.**
Consensus takes its second opinion from the first candidate of a *different vendor*, so
the first two entries are the pair that will grade almost every case. Until 2026-09-24
those two were the only two models with a measured false pass — on the same critical
scenario. Two models agreeing on a false pass is the one failure consensus exists to
prevent, so calibration is not advisory: it decides the order.

**A verdict has three ways to be absent, not one:** errored, `disputed` (two models
deadlocked, a third could not settle it), and unexecuted. Reports carry the **assurance
gap** — the share of the suite that produced no verdict.

**A conversation is graded whole.** A scenario with `earlier_turns` sends each turn with
the conversation so far; rules apply to every turn and the judges read every reply. An
agent with no `{{history}}` or `{{conversation_id}}` slot is not sent it — recorded as
not run, never flattened into separate messages. A `persona` scenario continues after a
human-written opening with a model playing the customer; its lines are labelled
simulated with their model, it never sees the assertions, and a report that includes one
says no real customer took part. A retest runs the suite's own case,
with the run's read-back and production guard — never a reconstruction from the row.

**There is one way to start a run.** The button, "rerun and compare", the API and the
schedule clock all call `startRun`, and the run page, the API and the clock advance runs
with `advanceRun` (`src/lib/workflow/start-run.ts`). A fifth copy is how the next
divergence starts. A slice holds `runs.lease_until` and a `lease_token`, taken in one conditional update
(0047). Every write the slice makes — saving a scenario, finishing, releasing, aborting —
names the token, so a slice that outlived its lease sends and writes nothing more; a
scenario already in flight at a takeover can still reach the agent twice, because nothing
can know whether the agent acted on the first. `started_at` is written once.

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
having no read-back configured). A 404 is unavailable — a missing record and a wrong address look the same — unless the scenario (`verify.not_found_means`) or the agent's read-back settings declare that a 404 means the record does not exist; then a non-HTML 404 is contradicted. The setting in force is frozen into the run's manifest. GET only by construction, the path cannot escape the
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
Judge funding is hybrid: our free-tier key for trials and for Agency Pro's managed runs
(`plan_managed`), the customer's own key otherwise —
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
src/app/verify/       public seal check by SHA-256: one read, the digest recomputed, no token, client, agent or transcript; receipts noindex. A dropped JSON export is hashed in the browser (`src/lib/report/canonical.ts`, byte-identical to `hash.ts`); only the digest is sent
src/app/api/badge/    embeddable SVG badge per sealed report, keyed by its SHA-256 (no opt-in needed: the digest is already public on /verify); 200 in every state, 60 s cache
src/app/solutions/    public landing pages (AI Act evidence, black-box testing, agencies); claims counted from the suite
src/lib/seo/          metadata helper, JSON-LD builders (no price, no Organization until published / the entity exists), OG card text
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
src/lib/cli/ + bin/   the `novera` CLI: verify, status (CI exit codes), export, suite validate
packages/cli/         its npm package, `novera-cli` (private until the user publishes it; `npm run cli:pack`)
src/lib/imports/      Promptfoo / DeepEval / LangSmith / Langfuse datasets → drafts, differences recorded
src/lib/redact/       pattern redaction (browser-safe) + storage record with hashes
src/lib/privacy/      data classes and provider ceilings, enforced by the router on every model call
src/lib/regressions/  a production failure → regression scenario, and its derived lifecycle
src/lib/simulate/     the simulated customer: persona prompt and reply parsing
src/lib/api/          API keys (mint, hash, authenticate) and the shared read layer for REST and MCP
src/lib/mcp/          the MCP server: JSON-RPC protocol; seven read tools, run and write tools by key scope
src/lib/schedules/    scheduled re-evaluations: UTC cadence, the clock's secret, the tick
src/lib/webhooks/     outbound webhooks: signing, queueing, delivery with backoff
src/lib/net/          the public-address guard every outbound request goes through
src/lib/auth/         the request's context (user, profile, active workspace, role) and the permission matrix
src/lib/audit/        the audit trail of access changes
src/lib/review/       failed scenarios as findings (new, recurring, resolved), derived from stored rows
src/lib/builder/      the Suite Builder: curated packs, sources (parse, fetch one page), extraction, discovery, coverage
data/packs/           curated baseline packs — selections of eu-support v5, byte for byte
supabase/migrations/  schema + RLS; every table's erasure path ships with it
data/suites/          versioned scenario suites (eu-support v1–v5; eu-gdpr-support, e-commerce-refund, fintech-kyc v1), calibration labels, and `.tiers.json` sidecars (triage tiers, not sealed)
src/lib/suites/       validation, the suite digest, tiers by scenario definition, computed changelogs, the catalog (/scenarios?tab=catalog)
src/lib/ci/           CI gating: trigger parsing, commit dedupe and supersede decisions, the exit-code gate, the GitHub Actions workflow generator
src/lib/checks/       the single-scenario check's label, verdict words and view state
src/lib/fixture/      the scripted fixture's per-suite replies and read-back records (eu-support's live in the route)
src/lib/explainability/ the glossary behind every `?` (`<ExplainTrigger>`); one disclosure implementation with `Help`
data/docs/            the published documentation, seeded into the database
docs/DECISIONS.md     append-only decision log — the reasoning behind everything here
docs/setup/           what is configured in a dashboard rather than in code, step by step (CI, email, monitoring, status, events)
src/lib/billing/      Stripe (sandbox until activated): config, webhook, entitlement, checkout and portal
src/lib/export/       the workspace export: an allow-listed copy of each table
src/lib/observability/ scrubbed error reporting (`onRequestError`), vendors off until configured
src/lib/analytics/    first-party product events, guarded properties, no third party
src/app/legal/ + data/legal/  draft legal documents for counsel review: noindex, not in force; the entity record, provider register, retention schedule, approved-version archive
src/lib/legal/        contract acceptance (fingerprints, art. 1203 clauses, B2B gate), publication rules, the report notice
docs/LAUNCH-READINESS.md  every launch work item with its proof and status
docs/COMPETITION.md   the market, what we took, what we declined
```

**Design tokens live in `src/app/globals.css`** — palette, shadows, radii, type scale.
Use them; never reach for a raw Tailwind palette step. Two defects came from ignoring
this, both invisible to inspection: a severity chip at 2.82:1 contrast on the client's
report, and a transparent tooltip that still occupied layout and pushed every page using
one 28px past a 390px viewport.

**Three levels, never mixed on one screen** (`docs/DESIGN.md`, 2026-10-02): *Decide* (page header with
one primary action, one health sentence, three metrics, at most five attention items), *Investigate*
(lists, filters, comparisons), *Prove* (a case's evidence chain, hashes, provenance — behind a tab, a row
that opens, or an explicit disclosure). Build pages from `src/components/ui/page.tsx`; tabs are addresses
(`?tab=`), so links and the back button work and nothing waits for JavaScript. Navigation is chosen by
account mode (personal, agency, enterprise); every existing URL keeps resolving.

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
| `npm test` | 1296 unit tests | free |
| `npm run typecheck` · `typecheck:6` | TypeScript 7's native checker (0.8 s) · TypeScript 6, which Next and typescript-eslint use. Run by path: both packages ship a `tsc` binary | free |
| `npm run migrate` · `seed:suites` · `seed:docs` | schema, suites and docs are current. `migrate -- --check` is read-only: who can reach the ledger, what is pending, where the ledger and the files disagree | free |
| `verify:db` · `verify:access` · `verify:tenancy` | append-only, RLS, erasure, cross-tenant isolation | free |
| `verify:identity` | profiles, roles in RLS, invitations, removal revoking keys, the audit trail, private conversations, memory isolation, trial per owner, retention, account and workspace erasure — as real signed-in users (needs `npm run dev`) | free |
| `verify:builder` | the Suite Builder: every pack, sources and their limits, verbatim passages, open questions holding approval, a hostile document, bulk approval with its audit line, discovery against the fixture, a scan that is never a report, a published suite that cannot change and runs, isolation, SSRF, retention, erasure (needs `npm run dev`) | free |
| `verify:export` | the workspace export: role, one download, expiry, no secret or token, another workspace refused (needs `npm run dev`) | free |
| `verify:byok` | the trial cap, and that our keys are never a silent fallback | free |
| `verify:billing` | Stripe's signed webhook through the real store (local database only, Stripe offline): ledger idempotency, the four lifecycle events, `plan_managed` attribution, 12 racing starts → 3, the 101st managed run and the 1,001st run refused, erasure | free |
| `verify:effect` · `verify:channel` · `verify:compiler` · `verify:conversation` | evidence rules, the metadata channel, the compiler's refusals, multi-turn scenarios | a few model calls |
| `verify:throttle` | the public forms cannot be made free | free |
| `verify:imports` | an imported case is a draft with frozen provenance, held to the same approval | free |
| `verify:api` | API keys and `/api/v1`: tenant isolation, identical refusals, revocation, rate limit (needs `npm run dev`) | free |
| `verify:mcp` | the MCP endpoint, driven by the official MCP client: isolation, tools per scope, refusals before any model call, frozen attribution, transport rules (needs `npm run dev`; `VERIFY_MCP_MODEL=1` also drafts and diagnoses for real) | free · two model calls |
| `verify:retention` | raw evidence past its period is emptied and nothing else changes; the fingerprint still matches; expiry mode opens nothing else | free |
| `verify:slices` | a run against a 10-second agent stays inside the 60 s function limit: several slices, every scenario recorded, none cut by our budget. The slow agent is a local server, not httpbin.org (needs `npm run dev`; no external network) | free |
| `measure:throughput` (`THROUGHPUT_LEVELS=1,2,4`) | concurrent trial runs against the fixture: wall time, verdicts without a result, how each was corroborated, per-vendor calls, rate limits and breaker skips | **real quota — one sweep** |
| `verify:free` | every free verifier in order, with a summary; checks first that the app answers and suites and docs are seeded, and never seeds for you. Each verifier makes what it needs (a sealed report, a slow agent) and erases it. Exit 2 = nothing failed but something could not be checked here | free |
| `verify:cron` | every scheduled job the guarantees depend on (four daily ones from 0037/0038/0040/0064, the clock from `schedules:clock`) exists, is on, and last succeeded; read-only. `migrate` exits 3 on a deployed database missing one. Exit 2 means "local stack without pg_cron", never a pass | free |
| `pilot:code -- create \| list \| revoke` · `seed:pilot-codes -- --file <outside the repo>` | creates pilot codes (only their HMAC is stored; `--generate` adds random characters and prints the code once), lists them by hint, revokes with a reason; asks `--yes` for any database other than 127.0.0.1. The repository is public: never commit a real code or a prospect's name | free |
| `verify:launch` (`-- --strict`) | read-only launch checks against the configured database and environment, the same functions `/readiness` shows: migrations (inferred from their objects, since the ledger is closed to the app), the four built-in suites, docs, two grading vendors, Stripe mode isolation, email, company details; prints the command that fixes each failing row. Exit 0 = nothing failing (waiting-on-a-person rows count only with `--strict`) | free |
| `verify:leases` | a slice that lost its run's lease sends no new scenario, saves nothing, and cannot release or abort the run; a takeover still completes the run with every scenario recorded once (needs `npm run dev`) | free |
| `verify:webhooks` | a real run is announced once to a local receiver, a failed delivery retried, the signature checks, the body carries no reply or policy, private addresses refused, rows frozen, secret unreadable (needs `npm run dev`) | free |
| `verify:schedules` | a due schedule starts one run however many ticks race; the clock drives it to the end; skip, pause, frozen fields, RLS, erasure (needs `npm run dev`) | free |
| `schedules:clock -- install \| status \| remove` | installs the pg_cron job that calls `/api/cron/tick`, secret in Vault; `status` shows its last calls | free |
| `verify:regressions` | a production failure is stored redacted, append-only, tenant-isolated, and reaches a suite only as a draft naming it | free |
| `verify:models` | every route candidate still answers | a few tokens |
| `demo:run` (`DEMO_SUITE_VERSION=4`) | the whole loop, end to end, publishing a report | a full run |
| `calibrate` (`CALIBRATE_SUITE=…`, `CALIBRATE_CASES=T37,…` for a subset, never stored) | judge quality and drift against ground-truth labels | **real quota — pace it** |
| `measure:stability` | verdict instability on identical responses | real quota |
| `NOVERA_QUERY_LOG=1 npx next dev` | prints every Supabase request as `[q]`; the lines above a page's request line are its cost — an N+1 reads as one table repeated per row. Last measured: 11–24 per operator page, 1 per report | free |
| `npm run novera -- report status <link>` | a sealed report's CI exit code (0 pass · 1 fail · 2 incomplete · 3 config · 4 infra), hash verified | free |

`npm run dev` must be running for `verify:effect`, `verify:channel` and `calibrate`:
they drive the scripted fixture at `/api/test-agent`.

## Working agreement

- Commits are authored as `cloudpxlsupport@gmail.com` — the account that owns the repo and
  the Vercel project. Vercel Hobby blocks any other author's commit from deploying; ten
  deploys were blocked on 2026-09-25 before this was found.

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
  in production before this was caught. 18 sealed reports now span payload formats 1–11 (new ones are 15); `novera report verify` re-hashes all of them.
- **A model's rendering of our data is not our data.** The judge echoed assertions back
  with the numbering the prompt added; storing that verbatim made every failed case render
  as fully passing.
- **Every table that refuses deletion needs an erasure path in the same migration.**
  Learned seven times. Evidence also has a second, narrower exit: the retention pass
  (0037) empties raw fields in place. A new raw-evidence column joins that pass.
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
- **Rewriting a file replaces everything it did, not only what the new feature needs.**
  The Phase 6A CSP rewrite of `proxy.ts` dropped the Supabase session refresh; every user
  was signed out an hour after signing in for two days. Read the old file's job first.
- **A constant in a sealed document is a claim about every run.** The report's
  environment line was one fixed sentence — "Customer-operated agent" — so a run against
  our own scripted fixture sealed a report describing a real customer. Derive what a
  report states from the run, never from a default.
- **The service role bypasses RLS, so tenant isolation cannot rest on it.** `createRun` read
  an agent by id alone, and another workspace's agent could be run against its own policy.
  Every reference between tenant tables is now checked in the database (0034).
- **React 19 resets a form when its action finishes, refused or not.** The connect form came back
  empty after "could not be resolved", edited request body and all. Every form a person types into
  uses `useKeepValuesOnError` (`src/components/ui/keep-values.ts`); passwords are never restored.
- **Motion is drawn over a finished state, never needed to reach one.** `Reveal` hid every block at
  opacity 0 with JavaScript off. Server-render the end state; `useMotion()` only replays it, and
  `docs/DESIGN.md` holds the layout, accent and motion system.
- **A page must not render a sentence a stranger supplied.** `/sign-in?problem=` printed
  whatever arrived inside Novera's own alert box, on the page that asks for a password.

## Open questions and known limits

- **Prices are approved (2026-10-12), not live.** Team BYOK €99/month (unlimited on your own
  key), Agency Pro €299/month (plus 100 runs a period on Novera's keys), trial 3 runs. Shown on
  Settings → Billing (`/billing`); checkout refuses a Stripe price that differs from the catalog.
  D3 decided 2026-10-12: after the trial every run needs a plan or grant (0067). Before live: VAT
  display, a funded grading budget for Agency Pro's managed runs, and publishing prices on the
  home page (it names the plans only) (`docs/BILLING-DECISIONS.md`).
- **Two grading vendors, not three.** No OpenAI or Anthropic key is configured (the
  2026-09-22 OpenAI key had no credits). Independence currently means groq + mistral. A
  funded key is one env line; `verify:models` then prints the calibration command, and the
  model enters a route only where its measured false passes place it.
- **Measured capacity on the trial keys (2026-09-29):** one run at a time is clean;
  four at once saturate Groq's free tier. With the grading gate and settling tie-breaks,
  48 of 48 scenarios still got a verdict, but 28 were corroborated within one vendor only
  (labelled as such). A third funded vendor is what fixes the second number.
- **Free-tier ceilings:** Groq 8,000 **tokens** per minute (not requests), Mistral about
  one request per second, Google's daily quota exhausted by a couple of calibration runs.
  Consensus doubles judge calls, so throughput is the thing to measure before promising
  concurrent customer runs. A full 36-case v3 run measured 27 seconds with four rate
  limits absorbed by fallback and no case lost.
- **A judge key stored before 2026-09-24 has no models recorded**, so it falls back to
  whatever `DEFAULT_ROUTES` measures on that connection — which is groq only. Any other
  provider's legacy key refuses the run with a sentence saying to reconnect it.
- **Legal texts are drafts (`docs/LEGAL-FRAMEWORK.md`; live status on the staff-only `/readiness` page).** The founder's memo (`docs/legal/2026-10-16-founder-memo.md`, AI-assisted research) is adopted as the current draft positions and as proposed answers to all 42 counsel questions, each awaiting counsel; the points where it looks wrong are listed in the counsel file. Terms 0.2, Privacy, DPA, Refunds, Imprint and the rest stay `noindex` and unlinked until counsel approves them and `data/legal/entity.ts` (all `null`) is filled. The acceptance ledger, B2B gate, report notice, provider register and retention schedule are built around them.
- **Billing is built for the Stripe sandbox and is not active, but it gates runs (D3, 0067).** No Stripe keys are configured, so nothing can be bought: a workspace past its trial runs only under a manual grant (SQL in `docs/BILLING-DECISIONS.md` §1). Legal pages under `/legal` are drafts, noindex and unlinked, until counsel signs off.
- **Production sends no email** (audit 2026-10-08, `docs/setup/sign-in-and-email.md`). The
  Resend variables are empty in Vercel, and Resend refuses the local key because `nover.space`
  is not verified there. Supabase custom SMTP needs the same verified key, and manual identity
  linking is off. The redirect allow list, Site URL, Google and GitHub are correct.
- **`eu-support v5` was swept on 2026-10-10** (local copy, 44 labelled cases): 0 false passes for
  all five candidates, ministral-8b 2 false fails (T07, T49); route order unchanged
  (`docs/setup/third-vendor.md`). The calibration harness does not send `earlier_turns`.
- **Runs execute in resumable 42-second slices** because Vercel Hobby kills a function at
  60. The deadline is checked before a case starts, never during one; an incomplete run is
  never finished, so no report is published over partial evidence.
