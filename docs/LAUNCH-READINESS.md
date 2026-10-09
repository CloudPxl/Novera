# Launch readiness

The state of every work item between Novera and a paid launch, checked against the code. One row per item. A row moves to **PASS** only with the proof named in its row: a test, a verifier, or a browser or API check. A check on the local stack is not a production check, and the row says which it was.

**Status:**

| Value | Meaning |
|---|---|
| PASS | Done and proven as stated |
| FAIL | Known defect, not fixed |
| BLOCKED | Waits on something outside the code: a dashboard, a credential or a decision |
| N/A | Does not apply |

**Class (from the Phase 0 reconciliation):**

| Value | Meaning |
|---|---|
| DEFECT | A confirmed defect |
| FIXED | Already fixed before this pass |
| CONFIG | A configuration blocker |
| DECISION | Needs a legal or product decision |
| NEW | Not implemented |

Last checked: **2026-10-09** (HEAD `bd02076` at reconciliation; updated per milestone).

## Phase 1: security, auth, truthfulness, product, mobile

| # | Work item | Risk | Owner | Class | Status | Proof | Configuration / decision |
|---|---|---|---|---|---|---|---|
| A1 | Production email: confirmation, reset, invitation, support reply | High: email sign-up and reset impossible | David (dashboards) | CONFIG | BLOCKED | Audit 2026-10-08: Resend variables empty in Vercel; domain unverified | Vercel env, Resend domain, Supabase SMTP (external list, below) |
| A2 | No send path claims an email was sent when it was not | High | Code | FIXED | PASS | Invitation says why it was not sent (`mailProblem`); a failed support send keeps the draft `approved` with `send_error` (platform audit, local) | — |
| A3 | Mail diagnostics with no secret shown; template previews in development | Medium | Code | NEW | — | — | — |
| B | Login CSRF: `/auth/confirm?token_hash=` signs the browser into whoever's link it is | Medium | Code | DEFECT | — | Reproduced locally 2026-10-08 (`magiclink` `token_hash` → `Set-Cookie`) | — |
| C | `/reset-password` changes a password with any session, not a recent recovery | Low–medium | Code | DEFECT | — | `setNewPassword` checks only for a user | — |
| C2 | Authenticated password change requires the current password | Medium | Code | FIXED | PASS | `passwordAction`, rate-limited; platform audit, local | — |
| D | Manual Google/GitHub identity linking | Medium | Code + David | CONFIG | BLOCKED | Code and callback `flow=link` exist (2026-10-06 walk with a mock GitHub, local). Production answers "not switched on" | Supabase → Allow manual linking; then one real link test |
| E | BYOK: diagnosis, drafting and builder extraction always used Novera's keys | High: privacy and attribution | Code | DEFECT | — | `src/lib/workflow/propose.ts:69,168`, `builder.ts:74` call `connectionsFromEnv()` | — |
| E2 | A model-kind agent used the workspace's judge key for any provider, or fell back to Novera's | Low | Code | DEFECT | — | `src/lib/agents/factory.ts:36` | — |
| F1 | Report "Graded by" lists only each case's first judge | Medium: a sealed claim | Code | DEFECT | — | `build.ts` derives `graded_by` from `judgeModel` only | — |
| F2 | A scenario never sent shows Novera's refusal under "What the agent replied" / "Observed" | Medium | Code | DEFECT | — | `case-table.tsx` falls back to `row.error`; `build.ts` prints `error` as `observed` | — |
| G1 | Agents: edit connection, archive with confirmation | Medium | Code | NEW | — | No action exists | — |
| G2 | Invitation context survives sign-in, sign-up, OAuth and reset; invitees skip solo onboarding | Medium | Code | DEFECT | — | Platform audit, local | — |
| G3 | Ask Novera states only computed numbers; malformed output never shown raw | Medium | Code | DEFECT | — | Platform audit: "1 trial run remaining" with 2 left; 3 of about 12 unreadable | — |
| G4 | Mobile 320–430: clipped tabs, top-bar wrap | Low | Code | DEFECT | — | UI audit, 1,334 loads (all at 390) | — |

**Already fixed in the 2026-10-08/09 audit pass** (`docs/audits/2026-10-08-full-app-audit.md`): client writes closed (0057), throttle RPCs, Next 16.4, rate limits on model buttons, invitations and forms, assistant ordering and `nvk_`/`whsec_` refusal, erasure of invitation addresses (0058), redaction numbering, support form secret scrub, production/test agent toggle, withdrawal of every report of a run, run-start refusals, read-back base, builder injection flag, fixture labelling.

## Phase 2: operations, reliability, data rights

| # | Work item | Owner | Class | Status | Configuration / decision |
|---|---|---|---|---|---|
| O1 | Error monitoring, scrubbed, off until configured | Code + David | NEW | — | A vendor DSN, if one is chosen |
| O2 | Status page driven by configuration | Code | NEW | — | — |
| O3 | First-party, privacy-aware product events | Code | NEW | — | Consent decision if a third-party tool is added |
| O4 | Backup and restore runbook; non-production drill | Code + David | NEW | — | RTO/RPO; Supabase plan's backup terms |
| O5 | CI on push and PR | Code + David | NEW | — | Branch protection in GitHub |
| O6 | Workspace data export | Code | NEW | — | — |
| O7 | Lifecycle email templates, sends off | Code + David | NEW | — | Approval after SMTP works; consent for anything non-transactional |
| O8 | Third, independent grading vendor | Code + David | CONFIG | BLOCKED | A funded key (OpenAI or Anthropic) |
| O9 | eu-support v5 full calibration | Code | NEW | — | Uses free-tier quota; paced |

## Phase 3: billing (Stripe, sandbox only)

| # | Work item | Owner | Class | Status | Configuration / decision |
|---|---|---|---|---|---|
| P1 | `docs/BILLING-DECISIONS.md` | Code | NEW | — | Prices, plans, tax: David, accountant |
| P2 | Billing schema: customers, subscriptions, grants, events, audit | Code | NEW | — | — |
| P3 | Checkout, Customer Portal and webhook (sandbox), idempotent and signature-checked | Code | NEW | — | Stripe test keys, webhook secret |
| P4 | Billing page, off without configuration | Code | NEW | — | — |
| P5 | Live activation | David | DECISION | BLOCKED | Entity, tax registration, prices, lawyer and accountant sign-off |

## Phase 4: legal and public documents (drafts for review)

| # | Work item | Owner | Class | Status | Decision |
|---|---|---|---|---|---|
| L1 | Privacy notice, terms, DPA, sub-processors, imprint, cookie notice, acceptable use, security and data flow, AI testing scope, refund placeholder | Code (drafts) + counsel | DECISION | — | Entity facts, roles, governing law: `docs/legal-inputs-required.md` |
| L2 | `docs/LEGAL-COUNSEL-QUESTIONS.md` | Code | NEW | — | — |

## External steps (David), in order

Kept current in the final section of this file once the code work is done.
