# Launch readiness

Every work item between Novera and a paid launch, with its proof. A row is **PASS** only with
the proof named in it. "Local" means the isolated local stack (`supabase` in Docker, the app copy
on :3100); "production" means www.nover.space. A local check is not a production check, and each
row says which it was.

**Status:**

| Value | Meaning |
|---|---|
| PASS | Done and proven as stated |
| FAIL | A known defect, not fixed |
| BLOCKED | Waiting on something outside the code: a dashboard, a credential or a decision |
| N/A | Does not apply |

**Last checked:** 2026-10-13, the V1 final audit against HEAD `e4a7f50`, locally and read-only in production (`docs/audits/2026-10-13-v1-final-audit.md`). V1 is closed. What remains is either waiting on the legal entity or is V2 fine-tuning (`docs/V2-PLAN.md`).

## Phase 1: security, auth, truthfulness, product, mobile

| # | Work item | Risk | Owner | Status | Proof | Configuration / decision |
|---|---|---|---|---|---|---|
| A1 | Production email: confirmation, reset, invitation, support reply | High | David | **BLOCKED** | 2026-10-11: `RESEND_API_KEY`/`RESEND_FROM_EMAIL` set in Vercel (Sensitive, unreadable) and production redeployed; public DNS for `send`/`rsend`/DKIM/DMARC correct; Resend's Verified status and Supabase custom SMTP not seen; no send proven. Email sign-up requires confirmation (`mailer_autoconfirm: false`) | `docs/setup/email-checklist.md` |
| A2 | No path claims an email was sent when it was not | High | Code | PASS | Invitation and support-reply failures stay truthful (`mailProblem`; draft stays `approved` with `send_error`, retry offered) — local | — |
| A3 | Mail diagnostics without secrets; template previews | Medium | Code | PASS | `/inbox/email` and `/inbox/email/preview` (staff); `src/lib/mail/diagnostics.ts`; template tests — local build | — |
| B | Login CSRF via `token_hash` links | Medium | Code | PASS | Local 7/7: an attacker's magic link starts no session; an attacker's confirmation leaves the victim signed in as themselves. Production: the magic-link URL is refused (`/sign-in?problem=link_invalid`) | — |
| C | Reset needs a fresh recovery context, not just a session | Low–medium | Code | PASS | 2026-10-11 local walk 17/17: PKCE reset continues signed in; a bare token_hash reset never touches the browser's session, sets the password with its sealed session, signs the account out elsewhere; a sign-in code sent as `flow=recovery` is refused. Production (before this fix): `/reset-password` refuses a direct visit | Deploy |
| C3 | A stored credential stays with its host | Medium | Code | PASS | `tests/agent-connection.test.ts`; read-back credential dropped on host change or removal | Deploy |
| C2 | Signed-in password change asks for the current password | Medium | Code | PASS | `passwordAction`, rate-limited — local | — |
| D | Manual Google/GitHub identity linking | Medium | Code + David | **BLOCKED** | Code and `flow=link` callback exist (mock GitHub walk, local). David reports the setting is on (2026-10-11); not independently proven — the public settings endpoint does not expose it | One real link test (manual test plan in the 2026-10-11 report) |
| E | A workspace's own key serves all its model work, with no fallback, recorded | High | Code | PASS | Mock-provider tests (`tests/model-work.test.ts`). Local: a diagnosis ran on the workspace key (`model_operations.funded_by = workspace_key`). 0059 applied in production | — |
| E2 | A model-kind agent uses no mismatched key and never falls back | Low | Code | PASS | `src/lib/agents/factory.ts` | — |
| F1 | Report names every grader in its role | Medium | Code | PASS | Format 14 `run.graders`; tests for two judges, settler and rule-only | — |
| F2 | A scenario not sent never shows Novera's refusal as the agent's reply | Medium | Code | PASS | Format 14 `no_result`; the label "Why there is no result" on every format; run-page evidence chain says "not sent"; all 9 local reports render | — |
| F3 | A scenario not sent is "not run": the run is INCOMPLETE, never "every scenario ran" | High | Code | PASS | `tests/coverage.test.ts`; found by the 2026-10-11 local demo run (T43 sealed as executed). Reports sealed before the fix keep their wording | Deploy |
| G1 | Agents: edit connection, archive with confirmation | Medium | Code | PASS | Local: edit audited by field name; archive by typing the name hides it, the database refuses its runs, restore works; `verify:identity` "Archiving an agent (0063)" passes; axe clean at 390/1440. 0063 applied in production | — |
| G2 | An invitation survives sign-in and sign-up; invitees skip solo onboarding | Medium | Code | PASS | Local: from the invitation to sign-in, back to the invitation, accept, team dashboard; `next` kept through sign-in | — |
| G3 | Ask Novera states only figures it was given; never raw output | Medium | Code | PASS | Local, 12 questions: 10 answered (5 after one retry), 2 factual fallbacks, 0 unreadable or unsupported shown. Limit: a correct computed figure can pass if it coincides with one in a sent doc | — |
| G4 | Phones 320–430 | Low | Code | PASS | Local: 75 loads (15 pages × 5 widths): no overflow, no clipped navigation, axe clean | — |

## Phase 2: operations, reliability, data rights

| # | Work item | Owner | Status | Proof | Configuration / decision |
|---|---|---|---|---|---|
| O1 | Error monitoring, scrubbed, vendors off | Code + David | PASS (vendors off) | `tests/observability.test.ts`; the test event came out scrubbed through a live dev server | Optional Sentry DSN (EU), then add to sub-processors |
| O2 | Status page, set by hand | Code + David | PASS | Production: `/status` says it is set by hand; `/api/health` returns `{"app":true,"database":true}` | Review `data/status.json` before linking it anywhere |
| O3 | First-party product events | Code + David | PASS (salt unset) | 0062 in production; property guard tests | `NOVERA_EVENTS_SALT` in Vercel; consent question for counsel |
| O4 | Backup runbook and drill | Code + David | PASS (local drill) | `docs/BACKUP-RESTORE-RUNBOOK.md`; local drill: 79 tables, 3,638 rows, 0 differences, 9/9 report hashes recompute | RTO/RPO; Supabase plan's backup terms; keep `NOVERA_ENCRYPTION_KEY` outside Vercel |
| O5 | CI on push and PR | Code + David | PASS (ruleset needs correcting) | GitHub Actions: 5 success, 2 superseded, 0 failed. Ruleset "Protect main" active since 2026-10-11 with 1 required approval and one required check; bypass list unreadable | 0 approvals (or no PR rule), both checks required (`docs/setup/ci.md`) |
| O6 | Workspace export | Code | PASS | `verify:export` local: one download, expiry, reviewer and other workspace refused, no secrets; 0061 in production | — |
| O7 | Lifecycle email templates, sends off | Code + David | PASS (off) | Templates and event map; a test fails if any app file sends one | Approval after SMTP works; consent for non-transactional mail |
| O8 | Third, independent grading vendor | David | **BLOCKED** | Review in `docs/setup/third-vendor.md` (Anthropic Haiku 4.5) | A funded key; a data-class decision |
| O9 | eu-support v5 calibration | Code | PASS | Local, 44 labelled: 0 false passes for all five candidates; order unchanged | — |
| O10 | Alerting: someone learns of an outage or error | David | **BLOCKED** | Errors go to Vercel logs only (Hobby keeps them about an hour); no uptime monitor | Uptime check on `/api/health`; Sentry EU DSN or `NOVERA_ERROR_WEBHOOK_URL` |
| O11 | Production backups and a restore point | David | **BLOCKED** | Runbook and a local drill exist; no production dump schedule; RTO/RPO unset; Supabase plan's backups not verified | Plan with daily backups/PITR, or a scheduled off-site `pg_dump`; RTO/RPO |
| O12 | Hosting terms fit a paid product | David | **BLOCKED** | Vercel Hobby is for non-commercial use | Vercel Pro before charging |
| O13 | Mail to `support@`/`dmarc@nover.space` arrives | David | **BLOCKED** | No MX on the apex: `support@` (shown in the app) and DMARC reports bounce | Namecheap email forwarding (adds MX), forward both addresses |

## Phase 3: billing (Stripe sandbox only)

| # | Work item | Owner | Status | Proof | Configuration / decision |
|---|---|---|---|---|---|
| P1 | `docs/BILLING-DECISIONS.md` | Code | PASS | — | Decisions D1–D10 |
| P2 | Schema: customers, subscriptions, grants, events, audit | Code | PASS | 0060 (27 refusals in a rolled-back transaction; RLS by role); applied in production | — |
| P3 | Webhook, Checkout, Portal: signature-checked, idempotent | Code | PASS (offline) | 28 tests with signed payloads (now also mode isolation, the read race, a retried unreadable subscription). **Not run against a Stripe sandbox:** as configured on 2026-10-11 the price variables have names the code never reads, there is no Preview deployment, and the destination points at production, which holds no keys (503) | Sandbox setup corrected per `docs/BILLING-DECISIONS.md` §5/§7 |
| P3b | Sandbox rows never count in production | Code | PASS | `storedLivemode`, 0065 (production 2026-10-11); tests | — |
| P3c | Approved prices: Team BYOK €99, Agency Pro €299 a month; cards, allowances, price check | Code | PASS | 0066; `priceMismatch`, `planAction`, entitlement tests; page rendered locally billing-off and sandbox at 390/1440, axe clean; a fake-key checkout refused with nothing created | Sandbox prices at exactly €99.00 / €299.00 |
| P3d | Agency Pro's managed runs can be spent; billing decides run starts | Code + David | PASS (code) | 0067 (D3 decided 2026-10-12): `startRun` refuses an unfunded run; `plan_managed` counted per period under a lock; fair use 3 in progress / 1,000 per 30 days. Local: 12 racing starts → 3 accepted, 101st managed and 1,001st run refused, `verify:byok` 30/30, UI walk 40/40 | A funded grading budget before Agency Pro is sold live; manual grants for anyone past the trial until billing opens |
| P4 | Billing page, off without configuration | Code | PASS | Production: `/settings/billing` behind sign-in; says "Billing is not active yet" without keys | — |
| P4b | Erasure never orphans a subscription | Code | PASS | Local: refused while active; allowed once ending at period end | — |
| P5 | Live activation | David | **BLOCKED** | — | Entity, tax registration, prices, lawyer and accountant sign-off |

## Phase 4: legal documents (drafts for review)

| # | Work item | Owner | Status | Proof | Decision |
|---|---|---|---|---|---|
| L1 | Privacy, terms, DPA, sub-processors, imprint, cookies, acceptable use, security, AI testing scope, refunds | Counsel | **BLOCKED** (drafts done) | Production: `/legal/*` 200, `noindex`, draft banner; `tests/legal.test.ts` (no compliance wording; placeholders) | `docs/legal-inputs-required.md`; not linked from the site until approved |
| L2 | Questions for counsel and accountant | Code | PASS | `docs/LEGAL-COUNSEL-QUESTIONS.md` (42 questions; 36–42 from the 2026-10-13 brief) | — |
| L3 | A privacy notice where personal data is collected (sign-up, support, apply) | Counsel + David | **BLOCKED** | No page links a privacy notice; `/legal` is draft and unlinked | Approved privacy notice, then link it from those forms |
| L5 | Contract acceptance before a paid plan: B2B details, Civil Code art. 1203 clauses accepted separately, record per version | Code | PASS (code) | 0068, `tests/legal-framework.test.ts`; local walk 33/33 (refused, recorded, unchangeable, receipt, checkout gated, erased) | Counsel on question 36; texts approved before live |
| L6 | Every report and export says testing evidence, not certification | Code | PASS | `src/lib/legal/notices.ts`; export tests; report page at 390/1440 | Counsel on question 39 |
| L7 | Company details on site and invoices (Law 365/2002 art. 5; Law 31/1990 art. 74) | David | **BLOCKED** | `data/legal/entity.ts` all null; live checkout refuses until complete | Entity details |
| L8 | No Stripe test key in production | David | **ACTION** | Production had test keys (billing active in test mode). Code now refuses a test key on production | Delete the Stripe variables from Production |
| L4 | Public commercial copy matches the pricing decision | David | PASS | D3 decided 2026-10-12. The home page and `/docs/the-trial-and-your-own-key` say: 3 free runs, then a plan (Team BYOK or Agency Pro). No prices published yet | Publish prices when billing opens |

## External steps (David), in order

The full list with owners and verification is in the 2026-10-11 reconciliation report. In order:

1. **GitHub ruleset:** set required approvals to 0 (or remove the PR rule), require both checks, and confirm the bypass list — until then nothing can reach `main`.
2. **Resend:** confirm the domain shows Verified (DNS is correct); create a sending key if needed.
3. **Supabase:** custom SMTP (`smtp.resend.com`, 465, `resend`, the key, `no-reply@nover.space`); email rate limit 30/hour; paste `docs/setup/email-templates/`.
4. **Production acceptance test** with a disposable address (`docs/setup/email-checklist.md` step 6), plus one Google/GitHub link test.
5. **Namecheap:** email forwarding for `support@` and `dmarc@`.
6. **Monitoring:** an uptime check on `/api/health`; an error destination.
7. **Backups:** confirm the Supabase plan's backups, or schedule an off-site dump; set RTO/RPO.
8. **Stripe sandbox,** corrected: `STRIPE_PRICE_TEAM_BYOK` (Preview), remove `STRIPE_PRICE_MONTHLY` (Production), a Preview deployment, the destination moved to it with a bypass secret, a throwaway workspace.
9. **Legal and commercial:** entity facts, D1–D10, counsel and accountant review, then link the privacy notice from the forms.
10. **Before charging:** Vercel Pro; live Stripe per BILLING-DECISIONS §7.
11. **After acceptance:** decide whether to delete the 2026-10-08 audit account (Claude will not do it without your word).
