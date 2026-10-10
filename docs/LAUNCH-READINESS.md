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

**Last checked:** 2026-10-10, HEAD `d1381ea` and later.

## Phase 1: security, auth, truthfulness, product, mobile

| # | Work item | Risk | Owner | Status | Proof | Configuration / decision |
|---|---|---|---|---|---|---|
| A1 | Production email: confirmation, reset, invitation, support reply | High | David | **BLOCKED** | Vercel `RESEND_*` still empty; Resend domain unverified (audit 2026-10-08) | `docs/setup/email-checklist.md` |
| A2 | No path claims an email was sent when it was not | High | Code | PASS | Invitation and support-reply failures stay truthful (`mailProblem`; draft stays `approved` with `send_error`, retry offered) — local | — |
| A3 | Mail diagnostics without secrets; template previews | Medium | Code | PASS | `/inbox/email` and `/inbox/email/preview` (staff); `src/lib/mail/diagnostics.ts`; template tests — local build | — |
| B | Login CSRF via `token_hash` links | Medium | Code | PASS | Local 7/7: an attacker's magic link starts no session; an attacker's confirmation leaves the victim signed in as themselves. Production: the magic-link URL is refused (`/sign-in?problem=link_invalid`) | — |
| C | Reset needs a fresh recovery context, not just a session | Low–medium | Code | PASS | Local: plain session refused; reuse refused; unbound reset signs out; PKCE reset via mailpit. Production: `/reset-password` refuses a direct visit | — |
| C2 | Signed-in password change asks for the current password | Medium | Code | PASS | `passwordAction`, rate-limited — local | — |
| D | Manual Google/GitHub identity linking | Medium | Code + David | **BLOCKED** | Code and `flow=link` callback exist (walk with a mock GitHub, 2026-10-06, local) | Supabase → Allow manual linking; one real link test |
| E | A workspace's own key serves all its model work, with no fallback, recorded | High | Code | PASS | Mock-provider tests (`tests/model-work.test.ts`). Local: a diagnosis ran on the workspace key (`model_operations.funded_by = workspace_key`). 0059 applied in production | — |
| E2 | A model-kind agent uses no mismatched key and never falls back | Low | Code | PASS | `src/lib/agents/factory.ts` | — |
| F1 | Report names every grader in its role | Medium | Code | PASS | Format 14 `run.graders`; tests for two judges, settler and rule-only | — |
| F2 | A scenario not sent never shows Novera's refusal as the agent's reply | Medium | Code | PASS | Format 14 `no_result`; the label "Why there is no result" on every format; run-page evidence chain says "not sent"; all 9 local reports render | — |
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
| O5 | CI on push and PR | Code + David | PASS (protection off) | GitHub Actions: success on `3f7294f` | Branch protection with the two required checks |
| O6 | Workspace export | Code | PASS | `verify:export` local: one download, expiry, reviewer and other workspace refused, no secrets; 0061 in production | — |
| O7 | Lifecycle email templates, sends off | Code + David | PASS (off) | Templates and event map; a test fails if any app file sends one | Approval after SMTP works; consent for non-transactional mail |
| O8 | Third, independent grading vendor | David | **BLOCKED** | Review in `docs/setup/third-vendor.md` (Anthropic Haiku 4.5) | A funded key; a data-class decision |
| O9 | eu-support v5 calibration | Code | PASS | Local, 44 labelled: 0 false passes for all five candidates; order unchanged | — |

## Phase 3: billing (Stripe sandbox only)

| # | Work item | Owner | Status | Proof | Configuration / decision |
|---|---|---|---|---|---|
| P1 | `docs/BILLING-DECISIONS.md` | Code | PASS | — | Decisions D1–D10 |
| P2 | Schema: customers, subscriptions, grants, events, audit | Code | PASS | 0060 (27 refusals in a rolled-back transaction; RLS by role); applied in production | — |
| P3 | Webhook, Checkout, Portal: signature-checked, idempotent | Code | PASS (offline) | 23 tests with signed payloads: bad signature, duplicate, out-of-order, abandonment, failure → grace → restricted, cancellation, reactivation, upgrade/downgrade, portal return, cross-workspace, price allow-list. **Not run against a Stripe sandbox (no test keys).** | Stripe sandbox keys and webhook secret |
| P4 | Billing page, off without configuration | Code | PASS | Production: `/settings/billing` behind sign-in; says "Billing is not active yet" without keys | — |
| P4b | Erasure never orphans a subscription | Code | PASS | Local: refused while active; allowed once ending at period end | — |
| P5 | Live activation | David | **BLOCKED** | — | Entity, tax registration, prices, lawyer and accountant sign-off |

## Phase 4: legal documents (drafts for review)

| # | Work item | Owner | Status | Proof | Decision |
|---|---|---|---|---|---|
| L1 | Privacy, terms, DPA, sub-processors, imprint, cookies, acceptable use, security, AI testing scope, refunds | Counsel | **BLOCKED** (drafts done) | Production: `/legal/*` 200, `noindex`, draft banner; `tests/legal.test.ts` (no compliance wording; placeholders) | `docs/legal-inputs-required.md`; not linked from the site until approved |
| L2 | Questions for counsel and accountant | Code | PASS | `docs/LEGAL-COUNSEL-QUESTIONS.md` (34 questions) | — |

## External steps (David), in order

1. **Resend:** verify `nover.space` (Domains → Verify DNS records); create a sending key.
2. **Vercel (Production):** `RESEND_API_KEY`, `RESEND_FROM_EMAIL=no-reply@nover.space`, `NOVERA_EVENTS_SALT` (16+ random characters); redeploy.
3. **Supabase:**
   - SMTP: `smtp.resend.com`, port 465, user `resend`, password = the Resend key, sender `no-reply@nover.space`.
   - Email rate limit: 30 an hour.
   - Turn on **Allow manual linking**.
   - Paste the templates from `docs/setup/email-templates/`.
4. **DNS `_dmarc`:** `v=DMARC1; p=none; rua=mailto:dmarc@nover.space; adkim=s; aspf=r`.
5. **Production acceptance test:** with a disposable address, run `docs/setup/email-checklist.md` step 6 (sign-up, reset, invitation to `delivered@resend.dev`, an approved support reply).
6. **GitHub:** branch protection on `main` with the two required checks; secret scanning with push protection; approval required for workflows from forks.
7. **Stripe:**
   - Verify the account.
   - In a sandbox, create products and prices with placeholder amounts.
   - Add a webhook to `/api/stripe/webhook`.
   - Configure the portal.
   - Set the test keys in Vercel *Preview* only.
   - Run the test-clock walk (`docs/BILLING-DECISIONS.md` §5, §7).
8. **Legal entity details** and decisions D1–D10 → **counsel and accountant review** of `/legal` and the billing items.
9. **Optional:**
   - A funded Anthropic key and a data-class decision (`docs/setup/third-vendor.md`).
   - A Sentry EU DSN.
   - An external uptime check on `/api/health`.
   - RTO/RPO in the runbook.
10. **After acceptance:** decide whether to delete the 2026-10-08 audit account (Claude will not do it without your word).
