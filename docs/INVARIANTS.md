# Invariants

What must always be true of Novera's data and behaviour, what enforces each one, and the negative test that
would catch it breaking. CLAUDE.md states the guarantees to customers; this file is the engineering
checklist behind them.

**Status** is as measured on 2026-10-01 at `b18dec7` (`docs/audits/2026-10-01-findings.md`):
- **holds**: a negative test exists and passes;
- **BROKEN**: a finding reproduces a violation;
- **untested**: no negative test exists yet.

Every BROKEN or untested row names the remediation item that adds its negative test. No row may be marked
holds without a test that would fail if it stopped holding.

## Runs and evidence

| # | Invariant | Enforced by | Negative test | Status |
|---|---|---|---|---|
| I1 | Every run has one manifest, declared before execution and frozen | 0016 trigger | `verify:db` (manifest edit refused); `tests/manifest.test.ts` | holds |
| I2 | Every declared case is recorded at most once per run, and only while the run is open | `unique (run_id, case_id)`; 0043 | `verify:db` (0043: undeclared id and row after completion refused) | holds |
| I3 | A declared case is either recorded, or the run is not `completed` | runner: an incomplete run is never finished (`execute.ts:641-649`) | `harness/webhook-grade.mts` plants the violation; no database check | untested in SQL (item 9) |
| I4 | No case counts as a pass without stored evidence; an errored case is never a pass; an evidence gap cannot sit on a verdict | 0019 | `verify:db` | holds |
| I5 | Error, unexecuted, unable to verify and disputed are never passes | 0019; `coverage()`; `gradeRun()` | `tests/coverage*.test.ts`, `tests/ci.test.ts` | holds |
| I6 | An uncorroborated verdict is never reported as corroborated | `judge_votes`, `independence.ts` | `tests/independence.test.ts` | holds. Whether it may count as a pass is decision G5 |
| I7 | An incomplete run cannot receive a grade; a run where everything ran but the evidence is insufficient is WITHHELD | `gradeRun()` | `tests/grade*.test.ts` | holds |
| I8 | One writer per run: a slice that lost its lease neither sends, saves, releases nor aborts | `claim_run_slice` (0041) only at claim | race A (atomic claim) passes; race B and B2 **fail** | **BROKEN** (C4, item 6) |
| I9 | A scenario is sent to the customer's agent at most once per run | the lease (I8) | race B: 3 scenarios sent twice | **BROKEN** (C4, item 6) |
| I10 | One misbehaving scenario (stalled body, huge reply, adapter exception) is recorded as that scenario's no-result and never aborts the run | adapter `try`; runner | `harness/agent-modes.mts` `/stall-body`, `/stall-first`, `/big-reply` | **BROKEN** (C5 item 3, C6 item 2) |
| I11 | A slice hands back inside the platform limit | `SLICE_BUDGET_MS`, deadlines | `verify:slices` (local responder variant) | holds for slow agents; **BROKEN** for large replies (C6) |
| I12 | Run attribution (who, which key, which schedule) cannot be rewritten | 0035, 0036 triggers | `verify:api`, `verify:schedules` | holds |
| I13 | Policy and suite versions are immutable once created | 0001 + append-only triggers | `verify:db` | holds |
| I14 | A fixture-only or destructive scenario never runs against a production agent | `agents.is_production`, runner | `tests/scenarios.test.ts` | holds |
| I15 | An external action is never represented as real without a receipt: a claimed action with no read-back is unverified, never a pass | effect rule (`judge/effect.ts`) | `verify:effect` (model calls); `tests/effect.test.ts` | holds in unit tests; `verify:effect` not run this audit |

## Reports

| # | Invariant | Enforced by | Negative test | Status |
|---|---|---|---|---|
| I16 | A report is sealed once, from stored rows, and never recomputed when read | `publishReport`, SHA-256 | `tests/build-report.test.ts` | holds |
| I17 | Verification fails after any mutation of a sealed payload | content hash, chain | `npm run novera -- report verify`; `tests/cli.test.ts`, `tests/build-report.test.ts` (tampered hash) | holds |
| I18 | Every old payload format (1–12) stays renderable and exportable | absence branches | `tests/build-report.test.ts`, `tests/report-export.test.ts` | holds |
| I19 | A revoked or expired report link refuses the page and every export | token checks | `verify:access` | holds |
| I20 | A reissued report carries the original unchanged and never moves the score | `reissue.ts`, format 11 | `tests/reissue.test.ts` | holds |
| I21 | Every automation surface (webhook, API, MCP, CLI, JUnit, n8n) gives the same outcome for the same run | four separate implementations | `harness/webhook-grade.mts`: agree on every runner state, disagree on a planted one | untested as a property (G7, item 9) |

## Tenancy, keys and secrets

| # | Invariant | Enforced by | Negative test | Status |
|---|---|---|---|---|
| I22 | A row refers only to rows in its own workspace, even for the service role | 0034 | `verify:tenancy` | holds |
| I23 | An API or MCP key reads and acts only in its own workspace | `authenticateApiKey`, 0033 | `verify:api`, `verify:mcp`, `harness/routes.mts` | holds |
| I24 | A revoked key stays revoked and is refused on REST and MCP | 0033 trigger | `verify:api`; `harness/revoke.mts` | holds |
| I25 | A workspace with its own model key is never graded on Novera's keys | router, 0025/0026 | `verify:byok` | holds |
| I26 | The trial funds at most three runs per workspace | `workspaceEntitlement` (application only) | `harness/idem.mts`: 7, 14 and 17 runs from 20 concurrent starts | **BROKEN** (C7, item 4) |
| I27 | No customer model key, webhook secret, API key or server credential appears in client bundles, logs, reports, exports or webhooks | sealing, server-only modules | `harness/canary.mts`; the bundle canary | holds |
| I28 | Webhook secrets are never readable by members | 0042 column grants | `verify:webhooks` | holds |
| I29 | Personal data a model quoted appears only as placeholders outside an explicit raw-evidence request | `scrub` in `buildReport` only | `harness/rationale.mts`: API and MCP return it | **BROKEN** (C9, item 11) |
| I30 | No client role can read or write the migration ledger | – | `harness/ledger.mts`: anon and authenticated have full access | **BROKEN** (C1, item 1) |
| I31 | A migration is skipped only because this runner applied it | ledger checksum | `harness/ledger.mts`: a forged row skips silently | **BROKEN** (C1, item 1) |

## Workflow states

| # | Invariant | Enforced by | Negative test | Status |
|---|---|---|---|---|
| I32 | Diagnoses are proposals; nothing changes until a person approves; a proposal whose target moved is refused | 0007 | `tests/diagnose.test.ts`, `verify:db` | holds |
| I33 | Approvals are human actions: no API or MCP scope approves, publishes, revokes or sends | 0022, 0030, 0039 | `verify:mcp` (tools per scope), `tests/mcp-scopes.test.ts` | holds |
| I34 | draft → approved → sent (and draft → published → executed) are distinct persisted states, forward only | 0009, 0022 | `verify:db` | holds |
| I35 | A production failure is stored redacted, append-only, and becomes a test only through an approved draft | 0031, 0044 | `verify:regressions` | holds |

## Webhooks

| # | Invariant | Enforced by | Negative test | Status |
|---|---|---|---|---|
| I36 | A webhook body and its signature are frozen once queued | 0042 trigger | `verify:webhooks` | holds |
| I37 | One delivery attempt per claim; every attempt counted; final states stay final | – | `harness/race.mts` C1–C3: 5 POSTs, attempts 1 | **BROKEN** (C2/C3, item 5) |
| I38 | Delivery is at-least-once: receivers must deduplicate on `Novera-Delivery`, and the docs say so | docs | – | docs say "once" (G2, item 13) |
| I39 | One workspace's broken delivery cannot block another workspace's | – | `harness/poison.mts`: blocks all | **BROKEN** (C8, item 5) |

## Retention, erasure and operations

| # | Invariant | Enforced by | Negative test | Status |
|---|---|---|---|---|
| I40 | Raw evidence past its period is emptied and nothing else changes | 0037 | `verify:retention` | holds (needs pg_cron) |
| I41 | Erasure removes all of a workspace's operational data and leaves only the erasure log row | `erase_workspace()` | `verify:db` (all 20 workspace tables) | holds |
| I42 | Every required scheduled job exists, is active and last succeeded | – | – | untested; fresh environments silently lack them (R1, item 7) |
| I43 | A public form cannot be made free, including during a database error | 0024 | `verify:throttle` | holds normally; fails open on RPC error (R3, item 12) |
| I44 | No public customer claim exceeds tested scope | review | – | untested (G2 is one instance) |

## Adding an invariant

1. Write it so that a test can falsify it.
2. Name what enforces it. Prefer the database, which binds the service role too.
3. Land the negative test in the same commit.
