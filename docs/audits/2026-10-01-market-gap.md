# Market gap — 2026-10-01

**Positioning: evidence-first assurance for authorised AI agents.** Not a browser or device grid, not
observability or tracing, not model training, not legal counsel, not a security certification.

This compares the product **as verified at `b18dec7`** with what a buyer of agent assurance expects. The
competitor facts are from `docs/COMPETITION.md` (sources fetched 2026-09-25) and were not re-fetched today.
"Today" means what this audit observed or what an existing test proves, not what the plan intends.

**The buyer**, throughout: a delivery lead at an agency or a small product team that ships a customer-facing
support agent in the EU. They have to show a client, a procurement reviewer or an incident reviewer that the
agent was tested, with what, and what was not proven.

**Pricing:** no price is proposed or changed here. "Packaging" only notes which tier a feature naturally
belongs to, against the structure already recorded in `docs/COMPETITION.md` (unpublished).

## P0 — what the buyer cannot do without

### 1. A sample report that shows every evidence state

- **Today:** `src/app/sample-report.tsx` shows pass, fail and "no result". It shows none of not run, unable
  to verify, uncorroborated, disputed, WITHHELD or INCOMPLETE. The real report renders all of them.
- **Buyer and job:** a prospect decides from the home page whether Novera's evidence is different from a
  pass rate.
- **Alternative:** TestMu publishes Pass / Fail / Unable to Verify with an assurance gap. Everyone else shows
  a score.
- **Value:** the one artifact that shows the differentiator before signup. Measure it by whether people who
  saw the sample go on to their first completed run (not instrumented today).
- **Scope:** a static fixture payload rendered by the real report component, labelled as sample data.
- **Security:** none. Synthetic data only, labelled as a fixture (product rule).
- **Evidence before claiming:** every state in the sample is produced by the real renderer from a payload that
  `buildReport` could seal (a test).
- **Packaging:** public.
- **Decision:** **build.** Customer-facing copy, so it needs your approval.

### 2. The evidence matrix, with saved views

- **Today:** lenses in the URL (`?lens=`) on the run page and the `/review` queue. A link is a saved view.
- **Gap:** no named or pinned views per workspace; no view across agents.
- **Alternative:** LangSmith and Opik annotation queues; Braintrust experiment filters.
- **Value:** the time a reviewer takes from opening a report to finding every case that needs a person.
- **Scope:** small. Named lens links stored per workspace (one table, RLS, an erasure path).
- **Security:** saved views must not carry raw evidence, only filters.
- **Evidence before claiming:** query budget ≤ 25 per page, measured.
- **Packaging:** all tiers.
- **Decision:** **build later.** URL lenses cover the job today.

### 3. One canonical release-gate outcome

- **Today:** four implementations (G7). They agree on every state the runner produces and disagree on a
  planted one (R2). `GET /api/v1/runs/<id>` returns no outcome, so every pipeline re-derives it.
- **Buyer and job:** a CI or n8n release gate must never let a release through on incomplete evidence.
- **Alternative:** Braintrust and Promptfoo CI give pass/fail; TestMu separates agent failures from
  environment failures. Novera's exit codes 0/1/2/3/4 already make the finer distinction. The gap is
  consistency, not capability.
- **Value:** zero disagreements between surfaces, by a property test.
- **Scope:** one pure function, an API field (`outcome`, `planned`), and the webhook and n8n changes.
  Remediation item 9.
- **Security:** none new.
- **Evidence before claiming:** the property test; the n8n gate re-run in n8n.
- **Packaging:** all tiers.
- **Decision:** **build (P0).**

### 4. An idempotent API

- **Today:** retries create new runs (G1), and with C7 they are not even capped.
- **Buyer and job:** a CI job that times out and retries must not spend two runs.
- **Alternative:** standard practice (Stripe-style `Idempotency-Key`). Absent in most evaluation APIs.
- **Value:** duplicate runs per retry: 1 → 0, by a test of 20 concurrent POSTs.
- **Scope:** remediation item 8.
- **Security:** the key never bypasses authorisation or entitlement; it is scoped per workspace.
- **Evidence before claiming:** the concurrency test.
- **Packaging:** all tiers.
- **Decision:** **build (P0).**

### 5. Webhooks a buyer can trust

- **Today:** signed, frozen bodies, no transcript, public addresses only (`verify:webhooks` 16 ok). But
  deliveries can be duplicated (C2), attempt counts lost (C3), one bad row stalls every workspace (C8), and
  the docs promise "once" (G2).
- **Alternative:** Stripe and GitHub publish at-least-once delivery with an id to deduplicate on. That is
  the expectation.
- **Value:** POSTs per delivery attempt equal 1 under concurrency; attempts counted exactly.
- **Scope:** remediation item 5, plus G2's wording after it.
- **Evidence before claiming:** the race tests in CI.
- **Decision:** **build (P0).**

### 6. Privacy and security data-flow documentation

- **Today:** `/docs/data-and-privacy` states the Frankfurt database, which providers may see personal data,
  retention periods and AES-256-GCM sealing. There is no single data-flow diagram, no sub-processor list
  with roles, and no statement of what an API key with `read` can see (raw replies, G6).
- **Buyer and job:** a procurement reviewer fills in a security questionnaire.
- **Alternative:** vendor trust pages (sub-processors, regions, encryption, retention, access).
- **Value:** questionnaire questions answerable from one page.
- **Scope:** one docs page generated from facts the code enforces: the data classes, retention, the scopes.
- **Security:** must not overclaim. R4 means "Novera calls only public addresses" needs its limit stated
  until pinning lands.
- **Evidence before claiming:** each sentence maps to a test or a migration. No compliance language.
- **Packaging:** public.
- **Decision:** **build.** Customer-facing copy, so it needs your approval.

### 7. Agency-ready n8n and CI examples

- **Today:** four n8n templates, each run in n8n on 2026-09-30, plus a GitHub Actions example in
  `/docs/cli-and-ci`. They lack an idempotency key and recompute the outcome themselves.
- **Value:** a working release gate in under 15 minutes from import.
- **Scope:** update them after items 8 and 9; re-run them in n8n.
- **Decision:** **build, after items 8 and 9.**

### 8. The scope-and-limitations block

- **Today:** on every report (`tests/build-report.test.ts`); "evidence of testing, not certification".
- **Decision:** **parity, keep.** Add a line on uncorroborated verdicts if G5 is decided as (b) or (c).

### 9. Proof of tenant and authorisation isolation

- **Today:** enforced in the database even for the service role (0034). It is proven by `verify:tenancy`
  (27), `verify:api` (33) and `verify:mcp` (30), and by today's route sweep. The proof is not visible to a
  buyer.
- **Value:** a reviewer can see that isolation is tested, not asserted.
- **Scope:** a short page listing what is enforced and which verifier proves it, without the harness.
- **Security:** describe the controls, not the attack surface. Keep C1 out of public copy until it is fixed.
- **Decision:** **build (docs), after C1.**

### 10. Stable report verification

- **Today:** SHA-256, chained to the previous report, verified by `novera report verify` and MCP
  `verify_report`; sealed formats 1–12 still render.
- **Gap:** verification needs Novera's server to be up. There is no offline verifier (P2).
- **Decision:** **parity-plus, keep.**

## P1 — what makes it worth renewing

| Feature | Today (verified) | Gap | Decision |
|---|---|---|---|
| Scenario packs by duty, channel and client policy | `eu-support` v1–v5 (49 scenarios, `layer` tags); the duty-to-test compiler drafts from a policy, quote-locked, with approval | No pack picker by duty or channel; one built-in suite family | **Build** a suite composer from `layer` and `duty_refs`; no new scenarios without labels and calibration |
| Per-turn checks | Shipped 12.4 (`tests/turn-checks.test.ts`) | – | **Parity, keep** |
| Trajectory and tool-argument evidence | `tool_arguments_include` / `exclude`, ordering, approvals (`tests/trajectory.test.ts`) | No OpenTelemetry trace ingestion | **Keep**; see P2 |
| Production failure → approved regression | 0031, 0044, `POST /api/v1/production-failures`, the n8n template (`verify:regressions` 13 ok) | – | **Parity, keep** |
| Baseline comparability; agent vs grader movement | Compare (format 10) and stability `moved: graders \| agent` | Comparability is not stated when the policy or the grader route changed | **Build** a "not comparable because …" line from the manifest (part of 12.6) |
| Provider calibration dashboard | Calibration stored (0018); no screen | The buyer cannot see the grader quality behind their verdicts | **Build after** the model audit (Step 9); never show figures that have not been measured |
| Delivery receipts and external-effect verification | Read-back confirmed / contradicted / unavailable; webhook delivery list in Settings | Receipts become trustworthy only after item 5 | **Build** (item 5) |
| Client-report mode | The report page is the client's artifact: placeholders for personal data and no raw replies (canary clean) | A `read` key shared with a client exposes raw replies (G6) and quoted personal data (C9) | **Build** the `responses` scope and scrub (item 11). Approval needed |
| Audit log | Every approval, revocation, policy version and publication is an attributed, append-only row | No single view, and raw-evidence reads are not logged | **Build** a read-only workspace audit view from the existing rows, plus the raw-read row (item 11) |

## P2 — when an enterprise asks

| Feature | Buyer ask | Decision and reason |
|---|---|---|
| More channels (voice, WhatsApp, email) | Agents beyond chat | **Defer.** Voice is on the not-building list; the others follow demand |
| Richer integrations (Jira, Slack, GitHub app) | Fewer glue steps | **Integrate through n8n first.** Its templates are proven; native apps later |
| Enterprise retention and export controls | Contractual periods | **Partly there** (30–365 days); extend on request |
| SSO/SAML, SCIM | Procurement checkbox | **Defer** until a customer requires it; Supabase supports SAML on paid plans |
| Private deployment | Data sovereignty | **Defer.** It contradicts one-person operation |
| Regional processing controls | EU-only processing | **Partly there** through data classes per provider; state it precisely (P0 #6) |
| Advanced analytics | Trends across runs | **Defer.** Risk of dashboards over thin evidence |
| Signed offline verifier | Verify without Novera | **Build when asked.** Small, and supports the integrity story |
| OpenTelemetry / OpenInference adapters | Import traces as tool evidence | **Integrate later.** Imported evidence must stay labelled as imported, never as observed |

## Not competing on

Browser and device grids, generic observability and tracing, model training, legal advice, certification.
Each is either crowded or contradicts the rule that a report states only what was tested.

## Order this implies

The P0 items that are also integrity fixes (3, 4, 5) come first, inside the remediation plan. P0 items 1, 6
and 9 are customer-facing copy and wait for your approval. They also should not describe isolation publicly
while C1 is open.
