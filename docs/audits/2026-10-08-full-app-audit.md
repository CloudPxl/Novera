# App-wide audit, 2026-10-08/09

## How it was run

Five audits ran in parallel:

| Audit | Method | Scale |
|---|---|---|
| Security and data integrity | Code plus live attacks on a local stack | All 40 public tables swept for cross-tenant reads |
| Evaluation loop | End to end through the UI and CLI against the scripted fixture | Three real runs |
| Platform features | Sign-in, roles, settings, API, MCP, assistant, public forms, erasure | — |
| Interface | axe, overflow, focus and print | 1,334 page loads: 232 routes and modes, 4 widths, light and dark |
| Completeness and drift | Code, docs and plan, read against each other | — |

The audit also checked production:

- **Signed-in sweep:** 77 paths at 390 and 1440, using a throwaway account. Read-only.
- **Public crawl:** 22 paths.
- **Database health:** read-only queries against production.
- **`verify:cron`:** passed against production.

Locally:

- **Tests:** 660, now 664.
- **Checks:** both typechecks, lint and a build.
- **Verifiers:** every free verifier, after each fix.

Each fix below was checked live on the local stack before it was pushed. Migrations were applied to production before their commit was pushed, because the repository is public.

## 1. Fixed during the audit

| Commit | What was wrong | What changed |
|---|---|---|
| `ee1f6ec` | Next 16.3.6 had six high advisories, and sharp had one in production dependencies | Upgraded to Next 16.4.0 and sharp 0.35.5. Production dependencies now audit at 0 |
| `c08642b` (0057) | **An operator could write `agents`, `scenario_drafts` and `production_failures` directly through PostgREST.** Reproduced: switched off the production guard, rewrote the attestation a report carries, stored an unredacted production failure under a teammate's name, and reattributed an approval. Anyone could also spend another person's rate limit | Client write policies and grants dropped. Attestation and draft decisions frozen by trigger. The rate-limit functions are callable by the server only |
| `c08642b` | Every unknown address in production logged 13 CSP errors (the 404 page was prerendered without a nonce) | Rendered per request |
| `397daa2` | Three buttons could spend Novera's trial model quota without limit: diagnose, draft from policy and builder extraction. Invitations were unbounded, with the link built from the request's Origin header. A new email address meant a new support-form allowance | 60 model calls an hour per workspace. 20 invitations an hour per person, with links built by `appOrigin`. Support and apply forms also counted per network address |
| `1cceadd` | The home page said "Email and password, nothing else". The trial was described per workspace. Limitations promised a second vendor. Five settings paths were stale. Reports were described as revoked rather than withdrawn. The guide promised a PDF export | Corrected, and docs reseeded |
| `814f02c` | Fixture runs were not labelled on operator pages. The report's table headers read "PASSEDGRADED". Ask Novera covered the menus and focus on phones. Pack drafts showed an empty policy quote. Green appeared on statuses that are not verdicts | Fixed, and measured again |
| `d0fe026` (0058) | **Ask Novera answered the previous question** (question and answer had tied timestamps). **`nvk_` and `whsec_` secrets reached the model.** Account deletion left the address on invitations. Regression redaction numbered placeholders per field, so the record said the agent set the old address. The support form stored keys and cards verbatim | Fixed, with tests and a `verify:identity` check |
| `f3a02e1` | **No agent could be marked a test target**, so destructive scenarios never ran and their suites stayed WITHHELD. Withdrawal left the original report live after a reissue. Starting a run returned a 500 on any refusal. A REST read-back base could not be saved. Injection-shaped source text went unflagged | Fixed: production/test toggle (owner or admin, audited), withdrawal of every report of the run, refusals shown at the button, a base that answers 404 accepted, deterministic flagging, and a destructive badge |

## 2. Does not work at all

1. **Production sends no email.** This blocks:
   - email sign-up confirmation and password reset (Supabase SMTP);
   - invitations and support replies (Resend).

   It is a dashboard fix; see section 6.
2. **Linking Google or GitHub to an existing account** fails ("not switched on"), because manual linking is off in Supabase.
3. **Sending a support reply from the inbox** fails for the same reason as item 1. The draft, approved and sent states hold correctly.

Everything else exercised works:

- Sign-in and Google/GitHub sign-in.
- Onboarding and the three account modes.
- Workspaces and the five roles.
- Connecting an agent, policies and imports.
- Compiler, Suite Builder, runs, stop, lenses and the case chain.
- Review, diagnosis, retest and rerun.
- Sealing, exports, withdrawal and reissue.
- Regressions, the CLI and API keys.
- REST and MCP, webhooks and schedules.
- Retention, the data export and account deletion.

## 3. Needs fixing (found, not yet fixed)

### Security and integrity

| Severity | Finding | Fix |
|---|---|---|
| Medium | **Login CSRF through `/auth/confirm?token_hash=`.** An attacker's own link signs a victim into the attacker's account, where the victim may then type an agent credential | Accept only the PKCE `/auth/callback`, or ask "Continue as …?" behind a same-origin POST |
| Medium | Diagnosis, draft and builder extraction always use Novera's provider keys, even for a workspace with its own key. That data flow is not in `data-and-privacy` | Route through the workspace key when there is one, or document it |
| Low–medium | `setNewPassword` (the reset page) needs no recent recovery; a borrowed session can change the password | Require a recovery session less than 10 minutes old, or reauthentication |
| Low | Address guard treats these ranges as public: `64:ff9b:1::/48`, `::ffff:0:0/96`, `2002::/16`, `fec0::/10` | Add them |
| Low | An API key keeps its scopes when its creator is demoted; only removal revokes it | Revoke or downscope on demotion |
| Low | `saveJudgeKey`, `connectAgent`, `saveVerificationEndpoint` and `createWebhook` make their outbound call before the role check. `saveVerificationEndpoint` stores the secret before checking the agent's workspace | Check the role first |
| Low | Two simultaneous approvals of one diagnosis may write two policy versions | Make the update conditional on `status='proposed'` and insert the policy after it |
| Low | `/api/v1` answers 405 with an empty body and 404 as HTML. The docs say every answer is JSON | JSON 405 handlers and a JSON 404 |
| Info | HSTS has no `includeSubDomains`/`preload`. No `robots.txt`, `sitemap.xml` or `security.txt` | Add them |

### Behaviour

- **Report "Graded by":** names one model, while two vendors voted. List every grading model.
- **A case never sent to the agent:**
  - Its evidence chain shows Novera's refusal under "What the agent replied", and the report prints it as "Observed".
  - `raw_sha256` is stamped although there was no reply.
- **Inverted model-drafted assertions:** a builder draft can contradict its own expected behaviour (D07: expected "do not cancel", assertion "says the account was cancelled"), and nothing catches it. Add a consistency check.
- **Imports:**
  - A Promptfoo test whose only assertion is `javascript` imports with its description as the expectation. Refuse it, or require an edit.
  - Re-importing an identical file duplicates every draft without warning.
- **Scenario drafts:**
  - Promote takes every approved draft; you cannot pick a subset.
  - The UI truncates validation errors to "(and N more)"; the CLI lists them all.
  - After a question is answered, the drafts resting on it still read "needs an answer".
- **Agent connection:**
  - The URL, body template, auth header and timeout cannot be edited.
  - An agent cannot be deleted.
  - Adding `{{history}}` later means a new agent and a lost history.
- **Runs and reports:**
  - A rerun drops the declared release and offers no field for it.
  - A withdrawn report's page answers HTTP 200; its exports answer 410.
  - A missing run, agent or build answers 200 with "Nothing here" (soft 404, accepted earlier as G4). The in-app not-found renders as a white full-height column.
  - The reports list cannot tell an original from its reissue, and links to the run.
- **Policy:** the editor stores CRLF line endings. Normalise them; diagnosis quotes depend on exact text.
- **Ask Novera:**
  - It still states numbers and validity it did not compute ("1 trial run remaining", "your key is valid").
  - About 1 in 4 answers came back unreadable.
  - Markdown links arrive raw.
  - Memory suggestions never appeared.
- **Sign-in:**
  - `?next=` is dropped when a signed-out person opens an operator page, and `safeNext` allows only five paths.
  - Sign-in and reset limits reuse the support form's sentence.
- **Invitations:**
  - Invited members are sent through the solo onboarding questions.
  - "Sign in to accept" does not return to the invitation.
  - The same address can be invited twice, and a second acceptance records a second "joined".
- **Workspaces:** duplicate names are allowed. There is no confirmation after create or erase, and erasing the last workspace silently creates a new one with the same default name.
- **Roles:** reviewers and auditors are shown the connect-agent form and the policy editor, which refuse on submit. Refusals there have no `role="alert"`.
- **Settings:**
  - Google's wrong-key error is the provider's raw text.
  - Removing a member has no confirmation and no visible result.
  - A duplicate schedule for the same agent and suite is allowed.
  - Cancelling a schedule shows no confirmation.
- **Dashboard:** "Reports ready 0 of 1" does not say what it counts.

### Interface polish (measured, all axe-clean)

- **At 390:**
  - Tab strips cut words ("Evidenc", "Ge…") and do not scroll the active tab into view.
  - "Run evaluation" wraps (also at 1024 in enterprise mode).
  - The mobile menu duplicates Settings and Audit.
  - On the report, "SCORE" sits alone on a third row, and "verdict(s)" reads awkwardly.
- **Headings:**
  - Settings h1 is the workspace name on five sections and the section name on two.
  - The default workspace name comes from the email local part and reaches sealed reports.
  - Enterprise `/workspaces` is headed "Clients".
- **Skip link:** missing on `/sign-in`, `/reset-password`, the global 404 and `/docs/<missing>`.
- **Small items:**
  - The public menu does not close on Escape.
  - `/report/<bad>` is titled "Agent evaluation report".
  - Ask Novera's panel is translucent over the page.
- **Tokens:** raw palette classes in the home release-gate panel and `agents/new`, and 52 arbitrary pixel font sizes.

## 4. Not implemented

**Market requirements for a paid EU B2B product:**
- **Legal pages:** privacy notice, terms, DPA, sub-processor list (Supabase, Vercel, Resend, model providers), imprint, accessibility statement.
- **Pricing and billing.**
- **Status page and error monitoring:** no Sentry or `onRequestError`.
- **Product analytics:** the plan's scoreboard cannot be measured.
- **Backups:** no restore runbook.
- **Lifecycle email:** no run-finished, trial-ended or schedule-paused messages. Notification preferences exist with no UI and no sender, and the report-format preference is stored but never read.
- **Staff tooling:** no admin view of users or workspaces, and no suspend.
- **SSO and SCIM:** deferred.

**Product:**
- **Data export:** no workspace export before erasure.
- **Report links:** fixed at 30 days, with no extension.
- **CLI:** unpublished.
- **Packs:** e-commerce, SaaS/B2B and multilingual are drafts.
- **Sources:** PDF is not accepted.
- **Grading vendors:** no third vendor, so independence is groq plus mistral.
- **Calibration:** no full eu-support v5 sweep.
- **Encryption key:** no rotation.
- **Payload:** the per-scenario `reply_sha256` is not in it.
- **Evidence writes:** a case and its observation are still two inserts (R6).
- **R4 pinning:** not proven on Vercel.

**Engineering:**
- **No CI:** no `.github/workflows`. Browser walks live outside the repository.
- **Large files:** the run page is 1,003 lines; `actions.ts` holds 16 unrelated actions.
- **Errors shown as empty:** the dashboard and settings read Supabase errors as "No runs yet" or zero.
- **Form state:** `import-suite` loses typed values on refusal.
- **Dead code:** `scripts/_crawl.mts` queries a table that does not exist.

**Docs:**
- No page covers account modes, workspaces, the role matrix or the Review views.
- `OBLIGATIONS.md` lists 10 of 16 obligation codes.
- `COMPETITION.md` marks shipped features as future phases.
- `README.md` is the create-next-app default.
- `.env.example` lacks `SUPABASE_DB_URL`, `CANONICAL_HOST` and `NEXT_PUBLIC_SITE_URL`.

## 5. What to improve next, by value

1. **Email (external):** without it, email sign-up and reset do not work. Nothing else matters as much.
2. **Legal pages:** privacy, terms, imprint and sub-processors. They need the operating entity's name and address, which only the user can supply.
3. **Close the login CSRF and the reset-session gap.**
4. **Agent editing and deletion**, and a rerun that carries the declared release.
5. **Assistant:** answer counts and validity only from computed values, and fix the unreadable rate.
6. **Report:** show every grading model, and keep the "not sent" evidence out of "replied".
7. **Invitation and onboarding flow for invited members.**
8. **CI:** run `npm test`, typecheck, lint and `verify:free` on every push.
9. **Interface at 390:** tab strips and the top bar.
10. **Error monitoring and a status page.**

## 6. Outside the repository (the user's steps)

1. **Vercel → Settings → Environment Variables (Production):** set `RESEND_API_KEY` and `RESEND_FROM_EMAIL=no-reply@nover.space`, then redeploy.
2. **Resend → Domains → `nover.space` → Verify DNS records.** If it will not verify, use a full-access key.
3. **Supabase → Authentication → Emails → SMTP Settings:** `smtp.resend.com:465`, user `resend`, password the same key. Raise the email rate limit to 30 an hour.
4. **Supabase → Sign In / Providers:** turn on **Allow manual linking**.
5. **DNS `_dmarc`:** `v=DMARC1; p=none; rua=mailto:dmarc@nover.space; adkim=s; aspf=r`.
6. **Delete the throwaway audit account** (`audit-…@novera.invalid`, two "Audit…" workspaces). The Supabase dashboard will refuse: an account that owns workspaces cannot be deleted there (`owner_id … on delete restrict`). It has to go through the app's **Delete my account**, which erases its workspaces first. Its password is only in this session's scratch file, so give an explicit go-ahead and Claude runs that deletion; the earlier attempt was stopped by a permission check.

Check afterwards: invite `delivered@resend.dev` under Settings → Members. The answer should start "Invitation sent".
