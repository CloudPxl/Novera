# V1 final audit: system-wide reconciliation, 2026-10-13

This audit closes V1. Each row below was measured: a command's exit code, a browser assertion,
a stored row, or an axe-core run. None of it rests on reading the code. "Local" means the
isolated stack (Supabase in Docker, the app copy on :3100, Mailpit). "Production" means
www.nover.space, checked read-only.

The audit started at HEAD `e4a7f50`. Its fixes are in the commit that adds this file.

## Command outputs

| Gate | Result |
|---|---|
| `npm test` | 809 tests, 809 pass, 0 fail, exit 0 |
| `npm run typecheck` (TypeScript 7) | exit 0 |
| `npm run typecheck:6` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0, 68 routes |
| `migrate -- --check`, production | 0 pending, 0 disagreements between ledger and files |
| `verify:free`, local | 15 verifiers pass. `verify:retention` and `verify:cron` exit 2 (no pg_cron locally, as always). `verify:schedules` passes after the leftover schedule was paused: see below |
| `verify:billing` (new), local | 27/27 |
| `verify:effect`, `verify:channel`, `verify:compiler`, `verify:conversation`, local | all pass (real free-tier model calls) |

**`verify:schedules` passed on the second attempt.** It first refused to tick, because a test
schedule left over from the 2026-10-08 walk was overdue in the local database and a local tick
would have started it. That was the guard working. David paused the schedule, and the rerun
passed every check: three racing ticks start one run, the run is driven to the end, skip and
pause, frozen fields, RLS, and erasure. CI and the Vercel deploy for this audit's commit
succeeded.

## Proof matrix

| Feature / boundary | Test applied | Result |
|---|---|---|
| **Auth** | | |
| Sign-up opens from `/sign-in?mode=signup` | Browser walk | Pass. Local GoTrue runs with confirmations off and goes to `/welcome`. Production requires confirmation (`mailer_autoconfirm: false`) |
| Email confirmation | A real sign-up token (admin `generateLink`) opened at `/auth/confirm` | Address confirmed, no session started in that browser, the same link refused a second time (`link_spent`), a malformed link refused (`link_invalid`), then password sign-in works |
| Session invalidation | Two browsers holding one session; "Sign out everywhere" in the first | Both return to `/sign-in`. The copied session no longer opens the app |
| Signed-out access | `/dashboard`, `/settings/billing`, `/billing`, `/runs` | All go to sign-in, locally and in production (307) |
| Password reset, same browser (PKCE) and cross-browser (`token_hash`) | `recovery-live` walk | 17/17: a reset in another browser never touches that browser's session; a sign-in code sent as `flow=recovery` is refused |
| Reset link landing at the root or an alias | `recovery-root` walk | 5/5 |
| Reset aliases with no recovery context | `/forgot-password` → `/sign-in?mode=reset`; `/update-password`, `/auth/update-password`, `/auth/reset-password`, `/password-reset` → "link expired, ask for a new one" | Pass, locally and in production |
| **RBAC and tenancy** | | |
| Role matrix | `tests/permissions.test.ts`; `verify:identity` (real signed-in users) | Pass |
| What each role is shown | Browser walk, five roles in one workspace | Billing management: owner and admin only. Model-key form: owner and admin. Invitations: owner and admin. Workspace erasure: owner only. 25/25 (including that each person was in the roles workspace) |
| RLS on `billing_*`, `secrets`, `runs`, `policies`, `contract_acceptances` | Anon-key client signed in as owner, operator and a stranger | No row of customers, subscriptions, webhook events, billing events, history or secrets is readable. Grants are readable by the workspace's own members (0060 policy) and by nobody else. Every direct insert, update and delete is refused or affects 0 rows; the run is unchanged afterwards. A stranger reads none of the workspace's runs |
| Cross-tenant isolation | `verify:tenancy`, `verify:access`, `verify:db` | Pass |
| **Billing and entitlements (0060–0067)** | | |
| D3: trial then a plan, own key or not | `verify:byok` 30/30; `verify:billing`; D3 browser walk 40/40 (billing off) and 39/40 with sandbox billing on (the one failure is the billing-off check, by design) | After 3 runs: `trial_used`, remedy `/billing`. Own key alone: still blocked. A grant or subscription lifts it |
| Attribution | `verify:billing` | Agency Pro without a key: `plan_managed` plus `funded_by_subscription`. With a key: `workspace_key`, still naming the subscription. Funding cannot be rewritten afterwards |
| Concurrency | 12 simultaneous inserts | 3 accepted, 9 refused `concurrent_runs_limit` |
| Managed allowance | 100 managed runs in the period | Run 101 refused `managed_allowance_exhausted` |
| Fair use | 1,000 runs in 30 days | Run 1,001 refused `fair_use_limit`; the application reports `fair_use` first |
| Webhook signature | Delivery signed with another secret | 400, nothing written |
| Webhook idempotency | `checkout.session.completed` delivered twice | Second answer `duplicate: true`; `billing_webhook_events` holds one row, `processed`, 1 attempt |
| `customer.subscription.updated` | Cancel at period end | Recorded; plan still active |
| `invoice.payment_failed` | Past due | `delinquent_since` set; the grace clock starts |
| `customer.subscription.deleted` | Cancelled | Plan ends; the database refuses a run it would fund (`run_not_funded`); remedy `/billing` |
| History and erasure | Same workspace | 4 history rows, no run deleted, workspace and billing rows erased |
| Checkout gate (§20.2) | Legal walk 33/33 | No checkout before an acceptance of the current texts; acceptance record append-only, no IP, erased with its workspace |
| Production billing | Read-only | Webhook answers 503 (test key refused on production) |
| **Evaluation engine and reports** | | |
| Run lifecycle, slices, leases | `verify:slices`, `verify:leases` | Pass |
| Evidence rules, read-back, channels, conversations, compiler | Four verifiers with real model calls | Pass |
| Sealed reports, production | `novera report verify` over every report | 18 live reports VERIFIED; the 2 withdrawn ones refuse (exit 3) |
| Exports | A live local report in md, csv, json and junit | Each carries the notice "Testing evidence, not certification", the SHA-256, a timestamp and "Grading funded by …". The sentence for each `judge_source` is unit-tested (`gradingFundedBy`) |
| **Interface** | | |
| Public pages | 19 routes × 390/1024/1440 | 57/57 loads: HTTP < 400, axe 0 violations, no horizontal overflow, no console error or hydration warning |
| App pages, as an owner with data | 29 routes and tabs × 390/1024/1440 | 87/87, same criteria |
| Top bar | Measured at each width | Billing reachable at all three; `aria-current="page"` at 1024 and 1440 (390 uses the menu); no overflow |
| `/billing` | Signed in | Routes to Settings → Billing |
| Production pages | Read-only `curl` | Public pages 200; app pages 307 to sign-in; Terms `noindex`; "nothing to pay" absent |

## Defect found and fixed

**A sealed report credited "unknown" with settling disagreements.** Format 14's "Graded by"
line assigned each stored vote a role by its position: first opinion, second opinion, settler.
When the third model could not be reached, consensus stores that vote as `unknown` with
status `error`. The report then said, for example, "unknown (settled disagreements on 4)",
although nothing settled those four cases: they are unresolved and counted as having no
result. A first or second opinion that errored was miscounted the same way.

The fix (`src/lib/report/build.ts`) counts only votes that returned a verdict, each still in
the role given by its position. A regression test was added to `tests/build-report.test.ts`.

The fix changes what new reports contain, not the payload schema, so sealed reports are
unaffected. No production report carried the wrong line: 1 of 20 has a grader list, and none
names `unknown`. The local report where it appeared was sealed before the fix and keeps its
text. That is what sealing is for.

## Added

`scripts/verify-billing.mts` (`npm run verify:billing`). It drives the real webhook handler
through the real Supabase store against a local database: Stripe stays offline, and the keys
are fake sandbox values in its own process. It covers the brief's billing rows: the ledger,
the four events, attribution, concurrency, the managed allowance, fair use, cancellation,
history and erasure. It refuses any database that is not local.

## Not checked here, and why

- **Production email delivery:** blocked on Resend verification and Supabase SMTP (A1).
- **The PDF of a report:** the report page prints. There is no server-generated PDF to verify.
- **Live Stripe:** forbidden until the legal entity exists and counsel approves. Only the sandbox was used, offline.
- **Scheduled jobs in production:** `verify:cron` needs pg_cron, which local Postgres lacks. Production was last checked in the 2026-10-11 reconciliation.
