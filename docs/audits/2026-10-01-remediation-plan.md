# Remediation plan — 2026-10-01

Proposed order, one item at a time, each by the protocol at the end. **Nothing here has been started.** It
waits for approval of the order.

**Order rule:** live exposure first, then whatever a customer's own agent can trigger, then cost and races,
then consistency, then copy. Migration numbers are provisional and assigned in this order.

| # | Item | Findings | Why here | Migration | Needs your approval for |
|---|---|---|---|---|---|
| 1 | Lock the migration ledger | C1 | Reachable today by anyone, in production, with a public key; the repo is public | 0045 | – (production apply is authorised) |
| 2 | Linear redaction and a reply-size cap | C6 | One agent reply can stall a slice past the platform limit | – | The size limit's wording in the docs |
| 3 | A stalled reply is a case, not an abort | C5 | A flaky agent discards the whole run | – | – |
| 4 | An atomic trial cap | C7 | Unbounded spend on the shared trial keys | 0046 | – |
| 5 | Webhook claim and lease; per-row failure | C2, C3, C8 | Duplicate side effects in customers' systems | 0047 | – |
| 6 | Run lease token | C4 | Duplicate agent calls, lost runs (precondition-dependent) | 0048 | – |
| 7 | `verify:cron` | R1 | A new environment loses retention silently | – | – |
| 8 | `Idempotency-Key` on `POST /api/v1/runs` | G1 | CI retries spend runs | 0049 | The API addition in the docs |
| 9 | One canonical outcome | G7, R2 (+ G5) | Every automation surface agrees by construction | – | **G5:** is an uncorroborated verdict a pass? |
| 10 | Self-contained verifiers and the local slow agent | T1, T2, T3, R5 | CI on an empty database | – | – |
| 11 | Raw evidence: scrub, scope and audit | C9, G6 | Least privilege for shared keys | 0050 | **G6:** the API change |
| 12 | Rate limits fail closed for public forms | R3 | Defence in depth | – | – |
| 13 | Docs: webhooks are at-least-once | G2 | After item 5 makes it true | – | **The wording** (in findings, G2) |
| 14 | Status 404 for missing and foreign pages | G4 | Monitoring accuracy | – | – |
| 15 | Smaller items | R6, R7, G8 | Low | – | – |
| 16 | Outbound connection pinning | R4 | Design change, needs its own test pass | – | Narrowing the claim, if pinning cannot be guaranteed on Vercel |
| 17 | The model-dependent audit (Step 9) | Untested | Needs keys and quota | – | Keys in the isolated stack; the funded OpenAI key |

## The items

### 1 · Lock the migration ledger (C1)

The fix must not depend on the ledger it protects. Once a fix migration is public, its checksum is public,
and a row forged before it runs would skip it silently.

1. **Pre-fix test**, `verify:db`:
   - `anon` and `authenticated` SELECT, INSERT, UPDATE and DELETE on `/rest/v1/novera_migrations`;
   - **expect refusal (fails today).**
2. **Fix:**
   1. `migrate.mts` runs `alter table … enable row level security; revoke all … from public, anon, authenticated;` before reading the ledger, takes `pg_advisory_lock`, and reports a recorded-but-not-applied row distinctly from CHANGED.
   2. Migration 0045 does the same, for databases only touched by the SQL editor.
3. **Production sequence:**
   1. Apply the two statements to production with `npm run migrate` from this machine, with nothing pushed yet.
   2. Confirm in the catalog that `relrowsecurity = true` and that anon and authenticated hold no grants.
   3. Then commit and push.
4. **Verify:**
   - `harness/ledger.mts` must show every anon and authenticated call refused, and the forged-row path impossible;
   - `verify:db`, `verify:tenancy`, typecheck, lint, build.

### 2 · Linear redaction and a reply-size cap (C6)

1. **Pre-fix test:** `tests/redact.test.ts`: 1 MB of `[A-Za-z0-9]` followed by an email redacts in under 200 ms (**fails today: about 7 s per 64 KB**).
2. **Fix:**
   - bound and left-anchor the EMAIL pattern;
   - check every pattern for the same shape;
   - stream the agent body with a 256 KB cap and record "the reply exceeded 256 KB" as a no-result with the size;
   - the same cap on read-back bodies.
3. **Verify:** a responder test (`/big-reply?mb=20`) gives one no-result row within one slice and a server that answers during it; the redaction tests still find every planted kind; `verify:slices`.

### 3 · A stalled reply is a case, not an abort (C5)

1. **Pre-fix test:** responder modes `/stall-body` and `/stall-first`: the run completes with 1 no-result row (**fails today: aborted**).
2. **Fix:** move the body read into the adapter's `try` under the same deadline; wrap `agent.send` per case in the runner so any adapter exception becomes an `error` case.
3. **Verify:** the agent-modes matrix (every mode gives a recorded row and a completed run); `tests/runner.test.ts`; `verify:slices`.

### 4 · An atomic trial cap (C7)

1. **Pre-fix test:** `verify:byok`: 20 concurrent starts on a fresh trial → exactly 3 runs (**fails today: 7–17**).
2. **Fix:** 0046, a `before insert` trigger on `runs`. For `judge_source = 'trial_free'` it takes `pg_advisory_xact_lock` on the workspace and refuses past 3. `startRun` maps the refusal to the existing sentence.
3. **Verify:** `verify:byok`, `verify:api`, `verify:schedules` (schedules start runs too), and the button path in a browser.

### 5 · Webhook claim and lease; per-row failure (C2, C3, C8)

1. **Pre-fix tests**, a new `verify:webhooks` section:
   - 20 concurrent deliverers, one row: POSTs = 1 for a 2xx; attempts = POSTs for a 500, a timeout, and accept-then-crash;
   - an immediate attempt overlapping a sweep;
   - an endpoint revoked while leased;
   - an undecryptable endpoint ahead of a healthy one;
   - the body and signature unchanged.
2. **Fix:**
   - 0047: `lease_token` and `lease_until`, and a partial index on pending rows;
   - the claim is one conditional update that increments attempts;
   - completions are guarded by the token;
   - `open()` moves inside the per-row `try`;
   - 0042's frozen-field trigger is extended to allow the lease columns.
3. **Verify:** `verify:webhooks`, `harness/race.mts` C1–C3, `harness/poison.mts`, and the immediate-delivery path on a real run.

### 6 · Run lease token (C4)

1. **Pre-fix test:** race B and B2 as a verifier: no scenario sent twice, the run completes, a stale release and a stale abort change nothing (**fails today**).
2. **Fix:**
   - 0048: `runs.lease_token`;
   - `claim_run_slice` writes and returns it;
   - release and abort are guarded by it;
   - the token is re-checked before each agent call;
   - `saveCase` treats 23505 on `(run_id, case_id)` as "already recorded" only after reading the stored row back.
3. **Verify:** race A (still exactly one slice), B, B2; `verify:slices`; `verify:schedules`; stop mid-slice still stays stopped.

### 7 · `verify:cron` (R1)

A free command. It lists the required jobs:
- `novera-raw-evidence-expiry`;
- `novera-inbound-probe-expiry`;
- `novera-stalled-runs`;
- `novera-schedule-tick`.

For each job it checks the schedule, the active flag and the last result. It exits 0 only when all are present and the last runs succeeded, and says "pg_cron is not installed here" distinctly. The migrations add a `raise notice` when they skip. Test it on the two fresh databases from this audit (without and with pg_cron).

### 8 · `Idempotency-Key` on `POST /api/v1/runs` (G1)

1. **Pre-fix test:** 20 concurrent identical POSTs with one key → 1 run; replay → 200 with the same id; a different body → 409 (**fails today: 2 runs from 2 posts**).
2. **Fix:**
   - 0049: `run_requests`, with a unique `(workspace_id, key)`, RLS, erasure, and 24 h expiry in the daily pass;
   - authorisation and entitlement run before the key is honoured;
   - the CLI sends a key;
   - the n8n templates send `{{$execution.id}}`, and are re-run in n8n.
3. **Verify:** `verify:api`, `tests/n8n-templates.test.ts`, the CLI tests.

### 9 · One canonical outcome (G7, R2; G5 decided first)

1. **Pre-fix test:** a property test over every combination of planned and stored case states and run statuses: webhook = API `outcome` = `ciOutcome` of the report that would be sealed; a missing planned case never gives `pass`.
2. **Fix:**
   - `outcomeFromStoredRun(snapshot)` in `src/lib/evidence/`;
   - the webhook and `GET /api/v1/runs/<id>` (new `outcome` and `planned`) use it;
   - the n8n gate reads `outcome`;
   - sealed payloads keep their existing `ciOutcome`;
   - a G5 change applies only to new payload formats.
3. **Verify:** `verify:webhooks`, `verify:api`, `verify:mcp`, `novera report verify` over every sealed report.

### 10 · Self-contained verifiers and the local slow agent (T1, T2, T3, R5)

- `verify:slices` uses the local responder.
- `verify:access` and `verify:mcp` seal their own rules-only report.
- `verify:retention` says "pg_cron not installed" instead of crashing.
- Scripts take `PGSSLMODE` and verify Supabase's CA otherwise.
- `npm run verify:free` runs the free set in order against an empty database.

### 11 · Raw evidence: scrub, scope and audit (C9, G6)

- Scrub `rationale` and `error` in `getRun` unless raw evidence was requested.
- After your decision on G6: a `responses` scope (existing keys grandfathered until rotation), one `api_key_reads` row per raw read (0050, with RLS and erasure), and `no-store`, which is kept.
- **Test:** the canary extended with a model-style rationale.

### 12–16

Each follows the same protocol when reached:
- **12:** fail closed for the public forms only, with a unit test.
- **13:** the G2 wording, after your approval.
- **14:** a 404 status, only if Next 16 can send it without breaking streaming, measured.
- **15:**
  - R6: one RPC for the case and its observation;
  - R7: a fixed reason category in webhook bodies;
  - G8: a skip link on public pages, checked with axe.
- **16:** connection pinning, its own test pass.

### 17 · The model-dependent audit

Before any call: provider, model, input class (synthetic fixture replies only), number of calls, quota and
cost, written down.

| Run | What it costs |
|---|---|
| `verify:models` | a few tokens per route candidate |
| `verify:effect`, `channel`, `compiler`, `conversation` | a few calls each |
| `calibrate` on v5 | ≈ 100–150 judge calls, paced |
| `measure:stability` | ≈ the same again |

All at temperature 0, on the free tiers. Customer-funded workspaces are never touched. OpenAI waits for its
funded key and its calibration.

## The protocol, per item

1. Reproduce the failure before the fix.
2. Add a regression test that fails before the fix.
3. Make the smallest safe fix.
4. Run the narrow test.
5. Run the affected verifiers.
6. Run `npm test`, both typechecks, lint and build.
7. If persistence changed: `migrate` on an empty database and an existing one, plus `verify:db` and `verify:tenancy`.
8. If the change is user-facing: a headless browser at 390 and 1440, axe and overflow.
9. Re-run the original reproduction.
10. Run the adjacent tests.
11. Read the diff for accidental changes.
12. Docs and customer-facing copy only with approval.
13. Commit, with one evidence line in `docs/DECISIONS.md`.
14. Report exact commands and outputs.

A failing test stays failing until its cause is found. No test is weakened to pass.

## Pushing

The repository is public.
- The findings document describes C1, so it should not be pushed until C1 is applied in production. The audit commit stays local until then.
- Every later push carries a fix together with the description of what it fixed.
