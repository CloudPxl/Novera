# Final pre-launch audit package, 2026-10-28

Release decision under audit: **controlled tester onboarding with Stripe payment infrastructure deferred.**

The fixes shipped in commit `3a04627` (deployed to production on 2026-10-29). Section 5 records the gates run on that tree. Items only David can do are in section 10.

The audit started at HEAD `91178a1` (main). Production is www.nover.space. Six tracks ran in parallel (A tester experience and pricing copy; B auth, tenancy and data lifecycle; C run execution and grading; D reports, sealing and integrations; E model-backed surfaces; F gates, infrastructure and operations). Their findings files are the detail behind this package. Five fix groups applied the fixes, an independent reviewer challenged the critical ones (its findings were fixed before commit; see section 4b), and the lead integrated, verified and committed them.

Two scope notes, stated once:

- **Stripe infrastructure is excluded by David.** Checkout, portal, subscription and webhook flows were not run. Billing and tester-access *copy* was in scope.
- **A "proxy" exclusion appeared in the audit brief, but no proxy workstream exists in the repo. David said to skip it.** See section 9.

How to read statuses in this document:

| Fix marker | Meaning |
|---|---|
| FIXED | Shipped in `3a04627`, with a regression test (`tests/final-audit*.test.ts`) or, for layout fixes, a browser check |
| DOCUMENTED | Behaviour kept, written down |
| OPEN | Not fixed in this release; disposition says where it goes |

---

## 1. Current architecture and capability map

Novera runs a versioned scenario suite against a customer's live AI support agent and emits a dated, hash-sealed conformity report. It is testing evidence, not a certification. The report is the product; the rest exists so that a report can be defended.

Inventory at the audit candidate (from `inventory.md` and the repository):

| Item | Count |
|---|---|
| Pages | 48 |
| Route handlers | 35 |
| Server actions | about 110, in 22 modules |
| Public tables | 58, row-level security on all |
| Migrations | 80 (0080 is new in this release) |
| Database functions | 82 |
| Triggers | 86 |

Platform: Next.js 16 (App Router), Tailwind 4, Supabase (Postgres, auth, RLS; Frankfurt), Vercel Hobby with functions pinned to `fra1`, Resend for email.

| Subsystem | What it does | Where |
|---|---|---|
| Identity and tenancy | Sign-in, sessions, workspaces, five roles, invitations, audit trail, cross-workspace refusal in the database | `src/lib/auth/`, `src/lib/workflow/identity.ts`, 0029, 0034, 0054 |
| Agents and connection | Connect a customer's HTTP agent, public-address guard, credential-follows-host rule, test connection, sample (fixture) agent | `src/lib/agents/`, `src/lib/net/` |
| Suites and scenarios | Versioned built-in suites, drafts that need a named approval, imports, extensions, language variants | `data/suites/`, `src/lib/suites/`, `src/lib/scenarios/` |
| Suite Builder | Curated packs, source documents, extraction, exploratory scan, publish | `src/lib/builder/`, 0056, 0077 |
| Run engine | `startRun` / `advanceRun`, 42-second resumable slices, leases, pacing, transport halt, stop | `src/lib/workflow/start-run.ts`, `src/lib/runner/` |
| Grading | Rules, then read-back, then two models from different vendors with a third to settle; routing by measured false passes; paid-budget governor | `src/lib/judge/`, `src/lib/providers/`, `src/lib/evidence/`, 0079 |
| Reports and sealing | Payload, SHA-256 seal, chain to previous report, exports, withdrawal, public verify, badge, CLI | `src/lib/report/`, `src/app/report/`, `src/app/verify/`, `bin/` |
| Entitlement and billing | Trial of 3 runs per owner, pilot codes and grants, plan allowance, fair use; Stripe built for sandbox, inactive | `src/lib/billing/`, 0060 to 0078 |
| Integrations | REST `/api/v1`, MCP, CI trigger and gate, webhooks, schedules | `src/lib/api/`, `src/lib/mcp/`, `src/lib/ci/`, `src/lib/webhooks/`, `src/lib/schedules/` |
| Model-backed helpers | Diagnosis, scenario drafting, Ask Novera, support drafting, simulated customer | `src/lib/diagnose/`, `src/lib/assistant/`, `src/lib/support/`, `src/lib/simulate/` |
| Privacy and retention | Data classes per provider, redaction, raw-evidence expiry, erasure paths | `src/lib/privacy/`, 0037, 0038 |
| Operations | Health and status, scrubbed error reporting, readiness checks, pg_cron jobs | `src/lib/observability/`, `src/lib/readiness/`, `scripts/` |
| Public surface | Home, solutions, docs (24 pages), legal drafts (noindex), SEO | `src/app/`, `data/docs/`, `data/legal/` |

---

## 2. User-journey and component coverage matrix

Statuses are only: VERIFIED LIVE · VERIFIED IN STAGING/LOCAL · VERIFIED WITH MOCKS ONLY · CODE REVIEW ONLY · BLOCKED · NOT TESTED · EXCLUDED BY DAVID · NOT APPLICABLE.

**"Live" means production read-only GETs.** No sign-up, sign-in, form post or run was made on production. Everything signed-in was tested on a local stack that runs the same code against a local database.

**Track B live attack testing was BLOCKED.** A safety classifier stopped the forged-request work (calling server actions and PostgREST directly with other users' sessions and identifiers), and the track did not resume it. Cross-tenant coverage therefore comes from two other sources: the project's own verifiers (`verify:tenancy`, `verify:identity`, `verify:access`, `verify:api`, `verify:mcp`, which drive the same paths as real signed-in users and passed in the Track F run) and Track D's 17 cross-workspace attempts over REST and MCP, all refused. A human-supervised re-run of the blocked part is listed in section 10.

| Journey or component | Status | Evidence | Residual risk |
|---|---|---|---|
| **Tester journey** | | | |
| Landing to a sealed report on the sample agent (390 and 1440 px) | VERIFIED IN STAGING/LOCAL | Four clicks, no staff step; mock graders (A) | Real-model timings not measured |
| Sign-up, welcome, double-click safety, back/forward/refresh mid-run | VERIFIED IN STAGING/LOCAL | One user, one workspace, one run per double click (A) | None known |
| Connect own agent, form value preservation, refused address | VERIFIED IN STAGING/LOCAL | Values kept; secret header value not restored (A) | A 404 agent is still created and cannot run until a policy exists |
| After-trial path: trial used, pilot code, `/apply` | VERIFIED IN STAGING/LOCAL | "Pilot, 5 left" after a code; wrong code keeps text (A) | 5-attempts-per-15-minutes limit read in code, not exercised |
| Sign-up email, password reset email, invitation email in production | NOT TESTED | No production sign-up allowed (F) | Production email unproven (F-5); see section 10 |
| Google and GitHub sign-in in production | NOT TESTED | Offered on `/sign-in`; not driven (F) | Fallback for F-5 if it works; unconfirmed |
| Print of a sealed report | VERIFIED IN STAGING/LOCAL | Header, hash, notice on page one (A) | None known |
| **Accessibility and layout** | | | |
| axe-core at 390 and 1440 on 20 public and 29 signed-in pages | VERIFIED IN STAGING/LOCAL | 0 violations (A) | No screen-reader test |
| Horizontal overflow at 390/768/1024/1440 | VERIFIED IN STAGING/LOCAL | Two defects found, fixed (A-3, A-4) | No Playwright regression test for the fixes |
| Keyboard, reduced motion, JavaScript off, 200% zoom, 320 px | VERIFIED IN STAGING/LOCAL | No focus trap; no hidden blocks (A) | None known |
| **Public surface (production)** | | | |
| 65 public URLs: pages, 24 docs, legal, robots, sitemap (36 URLs), llms.txt, 404, health | VERIFIED LIVE | 0 broken links; no price on any page (A, F) | `/favicon.ico`, apple icon, security.txt are 404 (F-12) |
| Security headers, canonical host redirect before cookies, TLS, region `fra1` | VERIFIED LIVE | Nonce CSP, HSTS, 308 apex to www, TLS 1.3 to 2026-12-19 (F, B) | Certificate renewal is Vercel-managed; watch near 19 December |
| `/api/health` and `/status` | VERIFIED LIVE | "ok", no counts or vendor names (F) | One abandoned run turns status amber (F-8) |
| **Authentication and tenancy** | | | |
| Server-action matrix: session, capability gate, workspace scoping (22 files, about 95 actions) | CODE REVIEW ONLY | Track B read every action | One gap found (B-2), fixed |
| Live forged server-action calls across tenants and lower roles | BLOCKED | Classifier stop (B) | Covered by verifiers below |
| Cross-tenant isolation and role checks as real signed-in users | VERIFIED IN STAGING/LOCAL | `verify:tenancy`, `verify:identity`, `verify:access` pass (F) | The live attack set was not run |
| Live PostgREST cross-tenant sweep per table | BLOCKED | Classifier stop (B) | RLS catalog read: all 57 tables read had RLS on; 17 have no policy so clients are denied |
| `SECURITY DEFINER` functions callable by clients | VERIFIED IN STAGING/LOCAL | 9 found; the callable ones key off the session (B) | None known |
| Role change or removal mid-session; API keys after demotion | CODE REVIEW ONLY, then fixed | B-1 | Unit test only |
| Invitation reuse, wrong address, expiry, revoke | CODE REVIEW ONLY | Database function `accept_invitation` (B); `verify:identity` passes | Not exercised live by Track B |
| Open redirects, callback junk, workspace cookie forgery | CODE REVIEW ONLY | `safeNext`, `pickActiveWorkspace` (B) | Not exercised live |
| Erasure during a run, account deletion across three workspaces, export contents | NOT TESTED | Blocked with the live part (B) | `verify:identity` and `verify:export` cover the paths on a clean run |
| Abuse limits: form throttle, sign-in and sign-up buckets, 64 KB bodies | VERIFIED IN STAGING/LOCAL | B-3 fix: one failed sign-in adds both counters (local DB rows); verify:throttle | — |
| **Run engine and grading** | | | |
| Errored and unexecuted cases never a pass (agent and grader failures) | VERIFIED WITH MOCKS ONLY | Chaos agents and mock model vendors (C) | Real grader behaviour not measured |
| One-model pass is not corroborated; CI exit 2 | VERIFIED WITH MOCKS ONLY | C, D | Surfaces other than the gate disagreed (D-1, fixed) |
| Unreadable grader output, fallback to next vendor | VERIFIED WITH MOCKS ONLY | Broken at 91178a1 (C-1), fixed | Real vendors' failure shapes may differ |
| Aborted, stopped, halted run never sealed; every scenario recorded once; racing advance callers | VERIFIED WITH MOCKS ONLY | C; `verify:leases` passes alone | `verify:leases` and `verify:slices` are sensitive to other runs on the shared grading slots |
| Completed run always gets its report | VERIFIED WITH MOCKS ONLY | Failed at 91178a1 (C-3), fixed | Late-seal path is new code |
| Paid-model budget governor (0079) | VERIFIED WITH MOCKS ONLY | Skips at the budget; rows hold no content; overshoot about one call (C-5) | Multi-instance overshoot by code review; fails open if total unreadable; keep the Google Cloud quota cap |
| Agent pacing, transport halt after three, redirect not followed, 256 KB cap, NUL handling | VERIFIED WITH MOCKS ONLY | C | A rate-limiting agent is not waited for (C-12, open) |
| Public-address guard (production mode, unit) | VERIFIED IN STAGING/LOCAL | Wide set refused; four gaps found (C-7), fixed | Other transition ranges not enumerated in Track C |
| Fair use, idempotency key, trial per owner, pilot-code races | VERIFIED IN STAGING/LOCAL | 6 parallel starts gave 3; 4 parallel idempotent gave 1; code race gave 1 grant (C) | None known |
| Read-back: confirmed, contradicted, unavailable; 404 handling | VERIFIED WITH MOCKS ONLY | False contradictions on provider shapes (C-6), fixed | Real provider records not seen |
| Suite Builder lifecycle, scan then publish | VERIFIED IN STAGING/LOCAL | `verify:builder` failed at 91178a1 (F-1 = C-8), fixed by 0080 | Production needs the migration |
| Single-scenario check limit (20 per hour) | VERIFIED IN STAGING/LOCAL | 25 parallel gave 20 and 5 refusals (C) | None known |
| Realistic agent shapes (nested JSON, message arrays, plain text, SSE) | VERIFIED WITH MOCKS ONLY | Plain text and SSE agents cannot be tested; arrays mis-hinted (C-4, C-11) | Plain text and SSE remain unsupported |
| Real model behaviour (obedience to injected text, quoting policies) | NOT TESTED | No real model calls | Needs `calibrate`; section 10 |
| **Reports, sealing and integrations** | | | |
| Parity of a run across ten surfaces (rows, REST, MCP, CI, JUnit, report, receipt, badge, CLI, summary, webhook) for eight run types | VERIFIED WITH MOCKS ONLY | D parity matrix | One failing row at 91178a1 (D-1), fixed |
| Withdrawal and expiry across page, exports, receipt, badge, REST, MCP, CI, CLI | VERIFIED WITH MOCKS ONLY | D | Badge carries no date (D-7, open) |
| Seal tamper detection; chain to previous report | VERIFIED WITH MOCKS ONLY | D | Page did not check the seal (D-4, fixed); chain can fork under concurrent sealing (D-5, open) |
| Historical payload formats 1 to 14 and a format-11 reissue on every surface | VERIFIED WITH MOCKS ONLY | Synthesised by stripping later fields | No real old rows exist locally; `novera report verify` over the live reports is a gate in section 5 |
| Output safety: markup, links, control and bidirectional characters across HTML, Markdown, CSV, JUnit, CLI, webhook, MCP | VERIFIED WITH MOCKS ONLY | D, E (headless Chrome, no dialog fired) | Markdown export and CLI were exposed (D-6/E-12), fixed |
| API scopes, revoked keys, cross-workspace attempts, idempotency, 64 KB limit, logging of raw reads | VERIFIED WITH MOCKS ONLY | 17 cross-workspace attempts refused (D) | API rate limit (120 per minute) not exercised by D; covered by `verify:api` |
| Webhooks: signature, redirect not followed, failing endpoint isolation | VERIFIED WITH MOCKS ONLY | D; `verify:webhooks` passes | Backoff by the clock and private-address refusal by code review only |
| CI trigger, supersede, generated workflow | VERIFIED WITH MOCKS ONLY | 8 racing triggers gave 1 run (D) | Re-run of an older commit supersedes the newer (D-8, documented) |
| Forbidden claim words in customer copy | CODE REVIEW ONLY | Static scan plus downloaded exports (D) | Ask Novera and support drafts were tightened (E-10, E-11) |
| **Model-backed surfaces** | | | |
| Data-class routing on a real run | VERIFIED WITH MOCKS ONLY | No free-tier Google or OpenRouter traffic (E) | Personal data reaches three vendors unredacted by design (E-17, decision) |
| Judge verdict parser with crafted replies | VERIFIED WITH MOCKS ONLY | Failed at 91178a1 (E-1), fixed | Real-model obedience not measured |
| Diagnosis, drafting, Builder extraction, persona, Ask Novera parsers and limits | VERIFIED WITH MOCKS ONLY | Harness (E) | Fixes unit-tested only |
| MCP write tools cannot approve, publish or send | VERIFIED IN STAGING/LOCAL | E (live4); `verify:mcp` passes | None known |
| Anonymous support form to drafting model | VERIFIED WITH MOCKS ONLY | E-4 | Prompt size bounded in the fix; vendor behaviour on oversize prompts not tested |
| **Operations** | | | |
| `npm test`, typecheck, lint, build, audit | VERIFIED IN STAGING/LOCAL | Section 5 (clean copy at 91178a1) | Final gates pending |
| `verify:free` (16 verifiers) | VERIFIED IN STAGING/LOCAL | 14 ok; `verify:builder` failed (F-1); `verify:leases` interfered with; two exit 2 for no local pg_cron | Final run pending |
| Fresh install of 79 migrations onto an empty database | VERIFIED IN STAGING/LOCAL | Applies cleanly; schema matches (F) | 0080 added after this check |
| `verify:launch` and `/readiness` against production | NOT TESTED | Would read production configuration | Inferred rows in section 8 |
| Secrets in git history (266 commits) and in the client bundle | VERIFIED IN STAGING/LOCAL | Only placeholders and documentation examples (F) | None known |
| Vercel and Supabase dashboards (plan, backups, SMTP, cron state) | NOT TESTED | No dashboard access (F) | F-2, F-3, F-5 |
| GitHub ruleset | VERIFIED LIVE | Public API, unauthenticated; bypass list not readable (F) | F-4 |
| Hosted backup and restore | NOT TESTED | One local drill from 2026-10-09 only | F-3 |
| Load test | NOT TESTED | Documented throughput data from 2026-09-29 only | About two concurrent full runs |
| Stripe checkout, portal, subscription, webhook | EXCLUDED BY DAVID | Code read only | See section 9 |
| Proxy workstream | NOT APPLICABLE | None exists | See section 9 |
| `/sample-report` | NOT APPLICABLE | Not routed; 404 with noindex, nothing links to it | None |

---

## 3. Security, multi-tenancy and evidence-integrity invariant register

The table lists the guarantees in `CLAUDE.md` that this audit exercised. "Held" means no counter-example was found by the evidence named. It does not mean proven for all inputs. Guarantees not listed here were not examined.

| Guarantee | Status | Evidence |
|---|---|---|
| Scores and counts come from stored rows; an errored case is never a pass | Held | Chaos agents and failing graders gave errors, never passes (C). Counts on REST matched rows in every parity run (D) |
| An unreadable or ambiguous grader answer is never a pass | Was broken, fixed | The verdict reader accepted an object the grader had merely quoted (E-1). Now every verdict object is read and disagreement is an error. `tests/final-audit.test.ts` |
| A verdict is two models from different vendors; independence derived from votes | Held after fix | One unreadable answer used to end a case and re-ask the same model (C-1); a lone answer was described as a disagreement (C-2). Fixed. `tests/final-audit-g1.test.ts` |
| A pass only one model gave is not corroborated and reads as incomplete evidence at the release gate | Held at the gate; was inconsistent elsewhere | Sealed methodology sentence, grade, badge, receipt, summary and JUnit disagreed with the gate (D-1). Fixed for new reports. Already-sealed reports keep their text |
| Evidence is append-only; a verdict cannot be edited or deleted | Held | `verify:db` passes; tamper test needed a database superuser and disabled the trigger (D) |
| A report was not edited after sealing; the seal is detectable | Held after fix | Receipt, badge, MCP and CLI detected an edited payload; the report page and CI gate did not (D-4). Fixed. `tests/final-audit.test.ts` |
| A report chains to the previous report for its agent | Partly held | Chain forks when two runs on one agent seal at the same moment (D-5). Open |
| A completed run has its report; an aborted run is never sealed | Was broken, fixed | A leak guard throwing after the run was marked completed left it without a report for good (C-3). Now completed means built. `tests/final-audit-g2.test.ts` |
| Exploratory scan is never a report | Held | `verify:builder` section on scans (C); database refusal unchanged |
| A suite build yields at most one suite | Was over-broad, fixed | The index counted a scan suite and stranded every scanned build (F-1 = C-8). Migration 0080 |
| Every report and export says it is testing evidence, not a certification | Held | Language scan of pages, docs, legal and downloaded exports found no claim words (D). Test-data labelling was missing in Markdown, CSV and webhook (D-3), fixed |
| A fixture is never shown as a real external action; test data is labelled | Held after fix | Labelled on page, receipt, badge, CLI, summary, JUnit; added to Markdown, CSV and webhook (D-3) |
| Withdrawn report stays withdrawn; link and exports refuse | Held | All surfaces refuse (D). Wording of the REST reason for a withdrawn report differs from CI (nit, open) |
| No paid plan starts without business details and accepted legal texts | Held, with a defect | With billing off the terms form stored a draft acceptance marked live (A-1). Form hidden and action refused while billing is not open. `tests/final-audit.test.ts` |
| Billing truth comes from Stripe's signed webhook | EXCLUDED BY DAVID | Not run |
| Trial of three runs per owner across workspaces; fair use; concurrent starts | Held | 6 parallel starts gave 3; fair-use 429s; empty abort spends nothing; erased workspace keeps its spend (C) |
| Pilot code redeemed once; pool shared across an owner's workspaces | Held | 10 parallel redemptions gave 1 grant (C) |
| Idempotent run start | Held | 4 parallel gave 1 run; changed body gave 409 (C, D) |
| A member's role decides what they may do, checked live | Held after fix | An API key kept its scopes after its creator lost the right to hold it (B-1). Demotion now revokes those keys with an audit line |
| A row can refer only to rows in its own workspace | Held | `verify:tenancy`; read-back endpoint for another workspace's agent was accepted silently (B-2), fixed |
| RLS on every public table; deny by default on secret-bearing tables | Held | Catalog read (B) |
| Customer model API keys never in bundles, logs, reports | Held | Bundle scan found no local secret values; log sites listed (F). Some error logs bypass the scrubber (low, backlog) |
| A stored agent credential never follows its address to another host | Not re-tested | Covered by `tests/agent-connection.test.ts`, which passed on App C (C) |
| Novera calls only public addresses; redirects reported, not followed; reads capped | Held after fix | Four IPv6 forms were allowed (C-7), fixed. A malformed response from a hostile endpoint could crash the Node process (F-6), fixed by a patched client |
| Agent paced; transport failures are not findings; three in a row halt the run | Held | Gaps measured 243 to 258 ms; halt after three (C). A halted or integration-error run still spends an allowance (C-4, C-12, open) |
| Raw evidence reaches API or MCP only with the `responses` scope and is logged | Held | Reads logged for REST and MCP; plain read omits replies (D) |
| A model provider receives only the data class its terms allow | Held as designed | No traffic to free Google or OpenRouter (E). Whether that design is acceptable for tester data is a decision (E-17) |
| Workspace key means all model work on that key; Novera-key work limited to 60 per hour | Held, extended | Limit was per workspace only; one person could own 25 workspaces (E-3). Now also per person. A workspace's own key is not limited |
| Novera's paid key never spends past its monthly budget | Held | Skip at budget, grading continued on free vendors (C-5) |
| A diagnosis is a proposal; a proposal whose target moved is refused | Held after fix | Approval could write text other than what was shown (E-6) and anchor on one character (E-7). Fixed |
| Drafted or imported scenarios need a named approval | Held | MCP write tools cannot approve or publish (E); Builder bulk approval still possible for low and medium drafts from a source with instruction-shaped text (E-9, open) |
| A person's profile and preferences never reach grading; memory refuses instruction-shaped values | Held after fix | Look-alike letters, invisible characters and synonyms stored instruction-shaped notes (E-11). Fixed |
| The in-app assistant links only to this workspace and shows no figure its inputs do not contain | Held after fix | About 40% of invented percentages passed because digits inside identifiers counted as known (E-10). Fixed |
| A browser holds one person; emailed links sign in only the browser that asked | Not re-tested live | Prior audit (2026-10-19) holds; this audit read code only (B) |
| Webhook signed, public address only, no redirect, no reply or policy in body | Held | D |
| Production failure stored redacted, cannot be edited | Not re-tested | `verify:regressions` passes |
| Retention: raw replies emptied after the period | Not verified here | `verify:retention` exits 2 locally (no pg_cron); the production job state is unread (F-2) |
| Only the migration runner can read the ledger | Held | `migrate -- --check` clean locally; fresh install of 79 migrations (F) |
| `/api/health` and `/status` name a status per component and nothing else | Held | Production read (F) |

---

## 4. Findings and remediation register

**Totals.** 6 tracks; 68 numbered findings plus 4 nits (A 8, B 4, C 12, D 12, E 19, F 13). Nine IDs are High (C-1, C-3, C-6, C-8, D-1, E-1, F-1, F-2, F-3); C-8 and F-1 are one defect, so eight distinct. The rest are Medium or Low as shown in the table. No Critical.

**Duplicates and overlaps.** C-8 = F-1 (one defect, one migration). C-9 = E-2 (one fix). E-14 is a subset of C-1. D-6 and E-12 are the same Markdown-export defect seen from two sides (one fix covers both). The totals above count each ID.

**Columns.** Class: A launch-critical, B small high-confidence improvement, C post-tester, D founder decision. Status is the tracks' evidence status (CONFIRMED needs a reproduction; SUSPECTED does not have one). "Retest" gives the retest done so far. Every unit retest still has to pass in the final `npm test` run (section 5). "Live" in the retest column means exercised against the local app, not production.

| ID | Sev | Cls | Status | Description | Fix or disposition | Regression test | Retest |
|---|---|---|---|---|---|---|---|
| **Track A: tester experience and copy** | | | | | | | |
| A-1 | Med | B | CONFIRMED | Terms accepted with billing off were stored as a live-mode acceptance of draft texts | FIXED. Acceptance refused while billing is not open; terms form shown only when billing is open | `tests/final-audit.test.ts` | Unit |
| A-2 | Med | B | CONFIRMED | After the trial every call to action said "Choose a plan" though no plan could be bought; the way out (pilot) was not named | FIXED. Label "Get pilot access" when billing is closed; refusal sentence names `/apply` | `tests/final-audit.test.ts` | Unit |
| A-3 | Med | B | CONFIRMED | On a phone, the client report's obligation table lost its Errored and Status columns | FIXED. Code marker in `src/app/report/[token]/page.tsx` | None found | None. Needs a 390 px overflow check |
| A-4 | Low | B | CONFIRMED | A long unbroken agent name overflowed the report, run page and runs list | FIXED. Wrapping added in those three places | None found | None. Needs a 120-character-name check |
| A-5 | Low | C | CONFIRMED | The sample agent's first report is withheld and the run costs one of three trial runs | OPEN. Backlog P2: one sentence on the sample run page. Whether the sample counts is a founder question | n/a | n/a |
| A-6 | Low | B | CONFIRMED | Workspace name is derived from the email address and titles the client-facing report | OPEN. Backlog P1 (it is the first thing a tester hands a client): ask for the name on `/welcome` | n/a | n/a |
| A-7 | Low | C | CONFIRMED | Billing-page, docs and one lifecycle email still describe plans and a pilot as if billing were open | OPEN. Backlog P2; see section 7 | n/a | n/a |
| A-8 | Low | C | CONFIRMED | Agency path calls the person's own workspace a "client workspace" and hides the sample agent | OPEN. Backlog P3 | n/a | n/a |
| **Track B: auth, tenancy, lifecycle** | | | | | | | |
| B-1 | Med | D | SUSPECTED (code) | An API key kept its scopes after its creator was demoted | FIXED. `changeRole` revokes keys the person created when the new role cannot manage keys; audit detail counts them | `tests/final-audit.test.ts` | Unit; live check pending |
| B-2 | Low | B | SUSPECTED (code) | `saveVerificationEndpoint` reported success for an agent outside the workspace | FIXED. Refused before any call or storage | `tests/final-audit.test.ts` | Unit; live check pending |
| B-3 | Low | B | CONFIRMED (code) | Sign-in and sign-up limits counted one email and one address together only | FIXED in `6f0d47b`: failed sign-ins are also counted per account (30/hour, from any address) and email-sending requests per source address (20/hour) | `tests/final-audit.test.ts` | local: two counters per failed sign-in |
| B-4 | Low | C | SUSPECTED (code) | The run-advance route needs membership only, not a named capability | OPEN. Probably deliberate (the run page polls it). Backlog P3: record the intent in the permission matrix | n/a | n/a |
| **Track C: execution and grading** | | | | | | | |
| C-1 | High | A | CONFIRMED (mocks) | An unreadable grader answer ended the case instead of trying the next vendor; the same-vendor fallback re-asked the model that had just failed (doubling paid calls) | FIXED. An unreadable verdict becomes a failed attempt; the next candidate is tried under the same exclusions; no model is asked twice per case | `tests/final-audit-g1.test.ts` (7) | Unit through the routed chat |
| C-2 | Med | A | CONFIRMED (mocks) | A case where only one model answered (unreadably) was counted and worded in the sealed report as "two models disagreed" | FIXED. First-opinion error gives no agreement value; coverage, run-page note and repair stop calling it a disagreement. Rows stored before the fix are not counted as disputes | `tests/final-audit-g1.test.ts` | Unit. Reports already sealed keep their sentence |
| C-3 | High | A | CONFIRMED (mocks) | A run whose report failed to build was left completed with no report for good. Reproduced with an agent that recites its own instructions | FIXED. The report is built before the run is marked completed; a completed run without a report is sealed later using the run's finish date; the leak guard now also sees multi-line literals and a quoted instruction is replaced by a placeholder | `tests/final-audit-g2.test.ts` | Unit |
| C-4 | Med | C | CONFIRMED (mocks) | Runs where no scenario can produce a verdict (agent refuses auth, redirects, non-JSON, event stream, empty body, oversize) run to completion and spend an allowance | OPEN. Backlog P1: halt on a streak of integration errors and exclude zero-verdict runs from the allowance count | n/a | n/a |
| C-5 | Low | B/C | CONFIRMED (mocks) | Budget governor works; three small gaps: multi-instance overshoot, a timed-out paid call is not recorded, fails open if the total is unreadable | OPEN. Accepted. The Google Cloud quota cap is the hard stop; keep it configured (section 10). Backlog P3: record timed-out paid calls | n/a | n/a |
| C-6 | High | A | CONFIRMED (mocks) | `refund_recorded` read-back falsely contradicted correctly refunded records in three common payment-provider shapes: a false fail settled without any model | FIXED. Contradiction only on the record's own contrary fields; unrecognised shape becomes unavailable; the three shapes are read | `tests/final-audit-g3.test.ts` | Unit (8 cases plus 541 related) |
| C-7 | Low | C | CONFIRMED (unit) | Four IPv6 forms that embed or route to internal space were allowed by the public-address guard | FIXED. Translated, 6to4, local NAT64 and site-local forms refused; public addresses in those families still pass. Other transition ranges (for example Teredo) were not in Track C's list and were not enumerated; backlog P3 to check the full set | `tests/final-audit-g3.test.ts` | Unit |
| C-8 | High | A | CONFIRMED | = F-1 | See F-1 | | |
| C-9 | Med | C | CONFIRMED (structure); effect SUSPECTED | = E-2 | See E-2 | | |
| C-10 | Med | D | CONFIRMED (data, code) | Built-in tool rules name the fixture's tool names, so against a real agent they silently test nothing and the report does not say so | OPEN. Decision. Backlog P1: per-agent tool-name map from discovery and a "rule not applicable" note per case | n/a | n/a |
| C-11 | Med | B/C | CONFIRMED (mocks) | For agents returning the whole message list, the suggested response path pointed at the customer's own message or an earlier reply | PARTLY FIXED. Hint never suggests an echo of the input, prefers the last assistant message, and states the fixed-position caveat. A "last element" path syntax and a runtime guard against reading the wrong message remain OPEN, backlog P2 | `tests/final-audit-g3.test.ts` | Unit |
| C-12 | Med | C | CONFIRMED (mocks) | A customer agent that rate-limits is not waited for (Retry-After ignored); the run halts after three and spends an allowance | OPEN. Backlog P1 (rate-limited staging bots are common) | n/a | n/a |
| **Track D: reports, sealing, integrations** | | | | | | | |
| D-1 | High | A | CONFIRMED | A one-model run sealed a methodology sentence saying two vendors graded it, and showed a clean A on the page, receipt, badge, summary and JUnit while the gate said incomplete | FIXED. Methodology and limitation wording derived from the votes; badge, receipt, summary, JUnit and exports say when passes rest on one model. Applies to new reports (format 13 on); older ones keep their sealed text. Whether a letter should appear at all in this case remains a founder question | `tests/final-audit-g2.test.ts` | Unit. Count existing production reports affected (section 10) |
| D-2 | Med | B | CONFIRMED | Copy client summary counted a disputed scenario twice | FIXED | `tests/final-audit-g2.test.ts` | Unit |
| D-3 | Med | B | CONFIRMED | Markdown and CSV exports and the webhook body of a fixture run did not say test data | FIXED | `tests/final-audit-g2.test.ts` | Unit |
| D-4 | Med | C | CONFIRMED (superuser edit) | The report page and CI gate trusted the stored seal; only the receipt, MCP and CLI recomputed it | FIXED. Page, exports, MCP and CI gate refuse a payload that no longer gives its seal | `tests/final-audit.test.ts` | Unit |
| D-5 | Med | C | CONFIRMED | Two runs on one agent sealing at the same moment both chain to the same previous report, forking the series | OPEN. Backlog P1: seal under a per-agent lock. The report code was refactored (prepare then store) but no lock was added | n/a | n/a |
| D-6 | Low | B | CONFIRMED | Control and bidirectional characters and markup from customer-supplied names reached the CLI output and the Markdown export unescaped | FIXED, together with E-12. Suite and workspace name length and character rules not confirmed in this draft | `tests/final-audit-g2.test.ts` | Unit |
| D-7 | Med | D | CONFIRMED | A badge carries no date and says "sealed" for as long as the digest exists, though the share link expires in 30 days | OPEN. Decision. Backlog P2 | n/a | n/a |
| D-8 | Low | C | CONFIRMED | Re-triggering an older commit aborts the newer commit's CI run | DOCUMENTED. Trigger time decides "newer"; `cancel_superseded:false` opts out | Docs only | n/a |
| D-9 | Low | B | CONFIRMED | The generated GitHub workflow treated "too many runs in progress" (429) as a configuration error | FIXED. Retries on 429 honouring Retry-After (at most 10 tries or 300 s), then exits 4; docs page regenerated | `tests/final-audit-g5.test.ts` | Stubbed curl under bash |
| D-10 | Low | B | CONFIRMED | Webhook `run.stopped` gave the wrong reason for an unreachable agent | FIXED | `tests/final-audit-g2.test.ts` | Unit |
| D-11 | Low | B | CONFIRMED | The MCP endpoint read request bodies of any size | FIXED. 64 KB cap, 413 with a JSON-RPC error | `tests/final-audit-g5.test.ts` | Unit |
| D-12 | Low | B | CONFIRMED | Run page said "Every scenario passed" for a stopped run with a scenario that never ran | FIXED | `tests/final-audit-g2.test.ts` | Unit |
| D-nit-1 | Low | B | CONFIRMED | Badge cache comment does not match the constant; clients receive no max-age | OPEN. Backlog P3 | n/a | n/a |
| D-nit-2 | Low | B | CONFIRMED | REST and MCP reason for a withdrawn report says "No report is sealed" while CI says withdrawn | OPEN. Backlog P3 | n/a | n/a |
| D-nit-3 | Low | B | CONFIRMED | Starting a run on another workspace's agent answers 409 on one route and 404 on another | OPEN. Backlog P3 | n/a | n/a |
| D-nit-4 | Low | B | CONFIRMED | `reports` accepts duplicate content hashes; not reachable through the app | OPEN. Backlog P3: unique index | n/a | n/a |
| **Track E: model-backed surfaces** | | | | | | | |
| E-1 | High | B | CONFIRMED (harness) | The verdict reader accepted an object the grader had only quoted from the agent's reply, so a quoted pass could become the verdict | FIXED. Every verdict object is read; disagreeing objects, or a pass beside a prose "fail", are unreadable and become an error, never a pass | `tests/final-audit.test.ts` | Unit (three crafted shapes). Real-model behaviour not measured |
| E-2 | Med | B | CONFIRMED (structure) | The agent's reply and other untrusted text were not delimited in the prompts, so a reply could forge the prompt's own sections | FIXED. Per-call random markers plus one system rule in the judge prompt, and a shared fence helper for diagnosis, persona, support question and Builder document. The judge rubric digest changes for new runs | `tests/final-audit-g1.test.ts`, `tests/final-audit.test.ts` | Unit. **Real-model obedience not measured: needs a recalibration (section 10)** |
| E-3 | Med | B | CONFIRMED (local); real-vendor cost SUSPECTED | Model work on Novera's keys had no policy-size bound, no per-person limit, and needed no trial or plan | FIXED (partly). 60,000-character policy cap on every write path including Builder; 60 per hour per person across workspaces. Requiring trial or entitlement for model work, moving the paid model behind free ones for diagnosis, and deduplicating diagnoses are OPEN, backlog P2 | `tests/final-audit-g4.test.ts` | Unit |
| E-4 | Med | B | CONFIRMED (local) | The anonymous support form sent the whole documentation corpus (about 187 KB) per question | FIXED. Best pages only, bounded excerpt; citations limited to what was sent | `tests/final-audit-g4.test.ts` | Unit |
| E-5 | Low | B | CONFIRMED | Ask Novera's prompt was several times larger than its code assumed | FIXED. Character budget | `tests/final-audit-g4.test.ts` | Unit |
| E-6 | Low | B | CONFIRMED | Approving a diagnosis could write a policy different from the one shown (replacement-pattern expansion) | FIXED. Literal replacement | `tests/final-audit-g4.test.ts` | Unit |
| E-7 | Low | B | CONFIRMED | Diagnosis quote anchor could be one character, or ambiguous; analysis and risks unbounded | FIXED. Quote of at least 12 characters and unique; applying an ambiguous one refused; analysis and risks bounded | `tests/final-audit-g4.test.ts` | Unit |
| E-8 | Med | B | CONFIRMED | Drafting from a policy kept legal references the policy never names, ignored the requested count, accepted a one-letter quote | FIXED. References taken from the policy, count enforced, minimum quote length | `tests/final-audit-g4.test.ts` | Unit |
| E-9 | Low | C | CONFIRMED | Builder injection detection is display-only, misses look-alike letters and never reads the drafted scenario's own text; drafts from such a source can still be bulk-approved if low or medium | OPEN. Nothing becomes a suite without a person, which still holds. Backlog P2 | n/a | n/a |
| E-10 | Med | B | CONFIRMED | Ask Novera's "no unsupported figure" rule let about 40% of invented percentages through and any worded claim | FIXED. Digits inside identifiers and timestamps no longer count as known; percentages exact; spelled-out balances checked; certification and compliance claims refused in replies and memory suggestions | `tests/final-audit-g4.test.ts` | Unit |
| E-11 | Low | B | CONFIRMED | Assistant memory guard missed look-alike letters, invisible characters, combining marks and synonyms | FIXED. Normalisation and wider phrase set. Database check kept in sync is not confirmed in this draft | `tests/final-audit-g4.test.ts` | Unit |
| E-12 | Low | B | CONFIRMED | Markdown export embedded model-written text raw (forged headings, links, images, HTML) | FIXED, with D-6 | `tests/final-audit-g2.test.ts` | Unit |
| E-13 | Low | B | CONFIRMED | A drafted scenario was marked destructive only for a literal boolean true | FIXED. Fail-safe flags: string or number values set the guard | `tests/final-audit-g4.test.ts` | Unit |
| E-14 | Low | C | CONFIRMED | Consensus re-asked the same paid model after an unreadable answer | FIXED with C-1 | `tests/final-audit-g1.test.ts` | Unit |
| E-15 | Low | C | CONFIRMED (code) | `observedChat` silently drops routing options (data class, exclusions, deadline) | OPEN. No leak today (the default is stricter). Backlog P3 | n/a | n/a |
| E-16 | Low | C | SUSPECTED (code) | A dormant "model agent" code path would bypass the router's data class and spend meter | OPEN. Not reachable today. Backlog P3: delete or route it | n/a | n/a |
| E-17 | Med | D | CONFIRMED | Testers' agent replies and policy text reach three model vendors unredacted by design, including the paid vendor, whose processing location is marked "to verify" in the provider register | OPEN. Decision for David and counsel (section 10) | n/a | n/a |
| E-18 | Low | C | CONFIRMED | The agent under test could steer the simulated customer to end the conversation early | FIXED with the shared fence and last-object rule (listed in LEAD as E-2 rest / E-18) | `tests/final-audit.test.ts` | Unit |
| E-19 | Low | C | CONFIRMED | Reports do not state that model verdicts are probabilistic | OPEN. Backlog P2: one sentence in the limitations block (applies to new reports only) | n/a | n/a |
| **Track F: gates, infrastructure, operations** | | | | | | | |
| F-1 | High | A | CONFIRMED | After one exploratory scan a Suite Builder build could never be published or scanned again; `verify:builder` failed at HEAD | FIXED. Migration 0080: the one-suite-per-build index excludes exploratory scans. **Production needs the migration** | `tests/final-audit.test.ts`; `verify:builder` | `verify:builder` publish section passes locally after migrate |
| F-2 | High | A | CONFIRMED (docs); production config SUSPECTED | Nobody is told when production breaks: no uptime monitor, no error destination evidenced, short platform log retention, no alert for a stopped scheduled job or red CI | OPEN. Owner action (section 10). Backlog P2: a self-check on stale retention jobs | n/a | n/a |
| F-3 | High | A | CONFIRMED (docs); plan SUSPECTED | No evidenced backup of production evidence; the runbook's plan row, RTO and RPO are blank; no hosted restore drill | OPEN. Owner action (section 10) | n/a | n/a |
| F-4 | Med | A | CONFIRMED | CI had been red on main since 2026-10-18 (secret-scan job tripped on three test fixtures); the branch ruleset did not prevent direct pushes; only the first CI job is a required check | PARTLY FIXED. Fixtures allowed line by line; the scan exits 0 locally. Making both jobs required and confirming the ruleset target and bypass are owner actions | `tests/final-audit.test.ts` | Local scan exit 0; CI on the release commit `{{FILL}}` |
| F-5 | Med | A (verify) | SUSPECTED | Production email (sign-up confirmation, reset, invitation) is unproven | OPEN. Owner action (section 10) | n/a | n/a |
| F-6 | Med | B | CONFIRMED (isolated reproduction) | A hostile agent, read-back, webhook or Builder-source endpoint could crash the Node process through a content-encoding bug in the HTTP client | FIXED. Patched `undici` 7.30.1; five guarded call sites use its own fetch with the guarded dispatcher | `tests/final-audit.test.ts` | Reproduction: the old path crashed the process, the new one rejected and survived. `verify:webhooks`, `verify:slices`, `verify:effect` pass |
| F-7 | Med | B | CONFIRMED (absence) | No deploy or rollback procedure written down | OPEN. Backlog P1 (15 lines). No fix recorded in `LEAD.md` | n/a | n/a |
| F-8 | Low | C | CONFIRMED | A tester closing the tab mid-run holds a run open for 24 hours; it holds a fair-use slot and turns the public status amber after 15 minutes | OPEN. Backlog P2; tell testers to keep the run page open (section 10) | n/a | n/a |
| F-9 | Low | C | CONFIRMED | Typecheck fails on a fresh clone until generated types exist | OPEN. Backlog P3 | n/a | n/a |
| F-10 | Low | C | CONFIRMED | No dependency-update automation and no audit step in CI | OPEN. Backlog P2 | n/a | n/a |
| F-11 | Low | C | CONFIRMED | `.env.example` and the launch-readiness document are stale | OPEN. Backlog P2 | n/a | n/a |
| F-12 | Low | C | CONFIRMED | Public pages are served uncached; no favicon, apple icon or security.txt | OPEN. Backlog P3 | n/a | n/a |
| F-13 | Low | D | CONFIRMED | Production runs on Vercel Hobby (non-commercial use) and Supabase free tier | OPEN. Decision before charging anyone | n/a | n/a |

Findings fixed in this release without a unit test: A-3 and A-4 (layout). They were checked in a browser instead: no horizontal overflow and no axe violations on `/runs`, a run page and a client report with a 120-character agent name, at 390 px, 640 px at 2× (200 % zoom) and 320 px.

### 4b. Independent review of the fixes

A reviewer who wrote none of the fixes challenged the critical ones before commit. Every defect it found was fixed and re-tested before `3a04627`:

| # | Severity | What the review found | Fix |
|---|---|---|---|
| R-1 | High | The first `refund_recorded` fix confirmed refunds that were only partly made: a partial refund, and a refunded object beside an open invoice | A refund confirms only when it covers the record's own amount; any amount remaining is contrary; every wrapper beside the record is read, and any contrary field wins; unsure means unavailable. The reviewer's 18 probes pass |
| R-2 | Medium | A transient error while building a report would have aborted a run whose evidence was complete | Only a policy leak aborts; any other failure completes the run and leaves the report to be sealed later |
| R-3 | Medium | Late sealing ran only when someone opened the run | The scheduler's clock now seals completed runs without a report (a few per tick, runs finished from 2026-10-29) |
| R-4 | Low–Medium | A run in flight across a change of grading instructions would be graded under two rubrics | A slice compares the run's frozen rubric digest with the running one and stops the run on a difference; it is never sealed |
| R-5 | Low | Runs completed without a report before this release would be sealed retroactively, out of chain order | Late sealing starts from 2026-10-29 |
| R-6 | Low | An exploratory scan paid a rebuild on every view | Skipped before any lease is taken |
| R-7 | Low | A double seal was prevented only by timing | The run keeps its lease until its report is stored; late sealing claims only a free lease |
| R-8 | Low | 0080 reset 0077's cut-off | 0080 reads the cut-off from the index it replaces |
| R-9 | Low | A failed key revocation on demotion was reported as success | It now says the keys could not be revoked |
| R-10 | Low | Two more IPv6 ranges passed the address guard | Refused |

Also changed in this release: the production dependency advisories (`undici` and `zod`) are cleared; `npm audit --omit=dev` reports 0.

---

## 5. Test and verification evidence

### Baseline gates at 91178a1 (Track F, clean copy of HEAD, no environment files)

| Gate | Result |
|---|---|
| `npm test` | 1351 tests, 1351 pass, 0 fail, 0 skipped |
| `next build` (Next 16.4.2, Turbopack) | exit 0; 7 whole-project tracing warnings from four files |
| `npm run typecheck` (TypeScript 7) | exit 1 on a copy with no generated types (4 errors on generated `PageProps` / `LayoutProps`); exit 0 after the build generated them. CI runs `next typegen` first, so this is an artefact (F-9) |
| `npm run typecheck:6` | same: exit 2 without generated types, exit 0 after |
| `npm run lint` | exit 0 |
| `npm audit --omit=dev` | 2 High: `undici` (three advisories) and `zod` (transitive). Both cleared by the fixes |
| `npm audit` (full) | 6 (3 High, 3 Moderate); the other four (one High, three Moderate) are dev or transitive |
| `migrate -- --check` (local) | 79 applied, 0 pending, 0 disagreements |
| Fresh install of 79 migrations onto an empty database | exit 0; schema matches the long-lived local database apart from column order and two index cutoff timestamps |
| Secret scan | exit 1 on three test fixtures (F-4); fixed |
| Secrets in git history (266 commits) and in the client bundle | Placeholders and documentation examples only |

`verify:free` at 91178a1 (against the local app, 2 min 21 s):

| Verifier | Result |
|---|---|
| db, tenancy, identity, access, byok, throttle, imports, regressions, api, mcp, webhooks, schedules, slices | ok |
| builder | **FAIL**, deterministic (F-1) |
| leases | FAIL inside the batch, PASS alone: the shared grading slots were occupied by other tracks' runs. Interference, not a defect |
| retention, cron | exit 2: no pg_cron on the local stack, as always. Never a pass |

CI on main at 91178a1: the "Lint, types, tests, build" job passed; the "Migrations and secret scan" job failed (F-4). Six consecutive pushes were red.

### Final candidate gates (to be filled after the release commit)

| Gate | Result |
|---|---|
| `npm test` | 1427 passed, 0 failed (1351 at 91178a1) |
| `npm run typecheck` (after `next typegen`) | clean |
| `npm run typecheck:6` | clean |
| `npm run lint` | clean |
| `next build` | compiled; 28 static pages |
| Secret scan (`scripts/scan-secrets.mts`) | no credential shapes in 869 tracked files |
| `npm audit --omit=dev` | 0 vulnerabilities (2 high at 91178a1: undici, zod) |
| `migrate -- --check` (local, then production by David) | local: 80 applied, 0 pending, 0 drift. Production: NOT RUN — the production database was not reachable from this session (owner action 1) |
| CI on the release commit, both jobs | both jobs passed on `3a04627` ("Lint, types, tests, build" and "Migrations and secret scan") — the first green main since 2026-10-19 |
| `novera report verify` over every live report | NOT RUN in production (same reason). Locally, 99 sealed reports re-hash; the 1 mismatch is the report Track D edited on purpose, which the page, exports, MCP and CI gate now refuse |
| verify:db | pass |
| verify:tenancy | pass |
| verify:identity | pass |
| verify:builder | pass except its re-hash of every report, which finds Track D's deliberately edited report (expected); publish after scan passes (failed at 91178a1) |
| verify:access | pass |
| verify:byok | pass |
| verify:throttle | pass |
| verify:imports | pass |
| verify:regressions | pass |
| verify:retention | exit 2 (no pg_cron locally; the rest pass) |
| verify:api | pass |
| verify:mcp | pass |
| verify:webhooks | pass when run alone (twice). In the batch its retry step waited behind 22 deliveries Track D left queued to stopped local receivers — the sweep handles 20 per pass, so delivery is delayed one pass, not lost (backlog: per-endpoint fairness) |
| verify:schedules | pass |
| verify:leases | pass |
| verify:slices | pass |
| verify:cron | exit 2 (no pg_cron locally) |

---

## 6. Business-logic and product-completeness review

**What works for a tester or agency.**

- A tester reaches a sealed report unaided: four clicks on the sample agent (Track A). With their own agent: connect, write a policy, run.
- The product is honest about what it claims. The home page, report header, run page and docs all say testing evidence, not certification, and test data is labelled on every sample surface (A, D).
- Across ten surfaces (database rows, REST, MCP, CI, JUnit, report, receipt, badge, CLI, summary, webhook), an ordinary run told the same story. Withdrawal, expiry and tamper detection were consistent (D). The one run type where surfaces disagreed was the one-model run (D-1), now fixed.
- The rules-then-read-back-then-models order, the three coverage numbers and the WITHHELD and INCOMPLETE words give an agency something to defend (D, E).

**Where assumptions break with real agents.** These are the points to expect in tester feedback.

- **Tool rules name the fixture's tools (C-10, open).** Rules in the built-in suite look for tool names such as the fixture's refund and delete tools. An agent exposing differently named tools never matches: the rule neither fails nor says it did not apply, so the critical "no unauthorised refund or bank change" scenarios lose their strongest check without any sign in the report. Rules can only fail, so this costs detection, not a false fail.
- **Response paths (C-11, partly fixed).** Chat backends commonly answer with the whole message list. The suggested path used to point at the customer's own message. The hint is better; a "last element" path syntax and a guard against reading the wrong message are still missing. Plain-text and event-stream agents cannot be tested at all.
- **Allowance spent on runs that produced no verdict (C-4, C-12, open).** A wrong token, a wrong path, a non-JSON answer, or a staging bot's rate limit gives a run with only errors, which still spends one of the three trial runs. "Test connection" mitigates but does not cover a token that expires or a rate limit mid-run. This is the most likely way a tester burns the trial on day one.
- **Read-back shapes (C-6, fixed).** The read-back reader was built on the fixture's record shape and produced false contradictions on three common payment-provider shapes. It is now conservative: only the record's own contrary fields contradict; anything unrecognised is "unavailable". Real provider records were not seen in this audit; letting the customer declare which field and value mean "refunded" (as is done for a 404) is the robust long-term answer.
- **Grading availability (C-1, fixed).** One vendor answering badly for a few minutes used to turn whole runs into "disputed" errors while the other vendors sat idle. Real free-tier models do this under load.
- **Single-model "Grade A" (D-1, fixed; letter policy open).** A report whose every pass rests on one model still carries a grade letter. It now says so beside the grade, but whether to withhold the letter is a founder question.
- **Sample report is withheld (A-5, open).** The first thing a tester sees is "grade withheld" on an agent nobody can fix, and it costs one trial run.
- **Workspace name titles the client report (A-6, open).** It is derived from the email address.
- **Concurrency.** Two grading slots are shared across all trial users. With several testers starting at once, the third waits ("waiting for grading capacity"). That is correct behaviour but should be in the tester briefing.
- **Abandoned runs (F-8, open).** Closing the tab leaves the run open for 24 hours, holding a fair-use slot and turning the public status amber. Tell testers to keep the run page open and reopen it to resume.

**What was tightened in this release.** Seal handling (D-1, D-4, C-3), unreadable-grader handling (C-1, C-2, E-1, E-14), prompt framing (E-2, E-18), read-back conservatism (C-6), model-work bounds (E-3, E-4, E-5), the Builder publish path (F-1), output escaping (D-6, E-12), test-data labelling (D-3), tester-access copy (A-1, A-2), and two process-level risks (F-6 crash, F-4 red CI).

**What an auditor or buyer will ask for that is not there** (Track D, for the roadmap, not for this release): an anchor for the seal outside Novera's database (a published signing key or a trusted timestamp); a way to keep evidence available beyond the 30-day link; the per-scenario list of passed scenarios with their provenance (only failures are listed); and a gap-free chain (D-5).

**Simplifications recommended by the tracks.** Compute every client-facing verdict word (grade qualifier, badge, summary, JUnit) from one function, as `pipelineOutcome` already does for REST, MCP, webhook and CLI (D). One shared "last JSON object, fail on disagreement" reader and one prompt-framing helper for every model call (E; both now exist). One token-budget guard in the router for Novera-owned connections rather than per-surface caps (E).

---

## 7. Pricing, commercial strategy and tester-experience consistency

**Decision in force (David, 2026-10-28).** Plan prices stay off every public page until the company and Stripe exist. Plan names may be public. Prices live on the signed-in billing page. The signed-in price figures are therefore not a finding.

**Consistency across surfaces** (Track A; public pages read on production, signed-in pages on the local build):

| Claim | Surfaces | Consistent |
|---|---|---|
| Trial is three runs per account owner, across all owned workspaces; no card | Home, five solutions pages, apply page, docs, dashboard, billing page, agents/new, top bar, emails, code constant | Yes |
| A sample-agent run counts as a trial run | agents/new, dashboard, docs | Yes, except the home page does not say it (A-5) |
| Plan names public, prices not | Home, docs, refusal text name plans; no figure on any public page, llms.txt, sitemap or structured data (all 65 production pages searched) | Yes |
| Agency Pro adds 100 runs a month on Novera's keys; Team BYOK none | Docs, billing page, refusal text, code | Yes ("a month" and "a period" used interchangeably) |
| Pilot is usually 50 runs over 30 days, once per owner, shared across owned workspaces, by code or request | Docs, billing page, apply page, code | Yes |
| Fair use: 3 in progress, 1,000 per 30 days | Docs, billing page, code | Yes |
| Bring-your-own providers | Docs, settings form | Yes |
| Grading vendors | Home says two vendors on Novera's key; privacy page lists the vendors and tie-breaks | Consistent; home is simplified |
| "Free forever" or "nothing to pay" legacy claims | Searched source, docs and public HTML | None found |
| Testing evidence, not certification | Report header, print, run page, home, llms.txt, limitations | Yes |
| Billing not active | Billing page banner is honest: nothing can be bought or charged yet | Yes. Other call-to-action surfaces were not (A-2, fixed) |

**Fixed in this release.**

- A-1: with billing off, no acceptance of draft legal texts is recorded or asked for. A draft acceptance labelled live was exactly the record the legal framework says must not exist.
- A-2: once the trial is used, with billing closed, the button, refusal sentence and top-bar text lead to pilot access (`/apply` or a code) instead of "Choose a plan". The pilot is the only way a tester can continue.

**Remaining copy items (A-7; item 1 fixed, the rest open, all copy changes).**

1. (Fixed with A-1: while billing is closed, the plans section of the billing page now says plans are billed once billing opens and that runs past the trial come from a pilot.)
2. The docs page on the trial and your own key says a workspace keeps running after its trial on a pilot. That is true only with a pilot. Say "only under a pilot (request one)".
3. The lifecycle email sent when the trial is used says a run needs a plan or a grant from Novera and does not mention requesting a pilot.
4. Agency path wording (A-8) and the sample-report explanation (A-5).

**Commercial note.** While Stripe is off, the single message to testers should be: "Billing opens later; pilots are available." Track A recommends driving every surface from `billingConfig().active` instead of letting each surface describe plans. That is the structural fix for this class of inconsistency; the two fixes above handle the surfaces a tester meets first.

---

## 8. Infrastructure and operational readiness

| Area | State | Reference |
|---|---|---|
| **Alerting** | None evidenced. Errors go to the platform log, which on Hobby keeps about an hour. An error webhook or vendor DSN is optional and not shown as set. Nothing alerts when a scheduled database job stops (retention, stalled-run stop, schedule tick) or when CI is red; red CI on main went unnoticed for nine days | F-2, owner action |
| **Backups** | None evidenced. The runbook's plan row is blank; RTO and RPO are placeholders; its own text says a Free project has no backup. The only restore drill was local (2026-10-09, 59 migrations then, 80 now). A restored or fresh database has no cron jobs unless pg_cron was enabled first | F-3, owner action |
| **CI** | Was red on main since 2026-10-18 (secret-scan job on three test fixtures). Fixtures now allowed; both jobs pass on `3a04627`. CI is fork-safe (read-only permissions, no secrets, pinned actions) | F-4 |
| **Branch protection** | The ruleset exists and is active, but main reported unprotected and six commits with a failing job reached main. Only the first CI job is a required check. The bypass list and branch target could not be read without admin access | F-4, owner action |
| **Email** | Unproven in production. The repo's own record says no confirmation email has ever been sent by production. DNS shows forwarding MX, DMARC and the sending subdomain records present. Whether custom SMTP is configured is not visible. The built-in mailer delivers only to project team members. A tester signing up by email may not receive a confirmation | F-5, owner action |
| **Capacity** | About two testers running a full suite at the same time is safe on the free grading keys. 5 to 10 testers in total, spread over days, is reasonable. At 5 to 10 simultaneous full runs most verdicts would be corroborated within one vendor only (labelled) and runs would queue. Basis: the 2026-09-29 throughput measurement plus the grading gate (two concurrent slices) and the paid third vendor added since; the figure for the paid vendor is an estimate, not a measurement. Limits that bound one tester: 60 model operations per hour, 3 runs in progress, 1,000 runs per 30 days | F, DECISIONS |
| **Paid-model budget** | $50 per month default; grading continues on free vendors after it. The Google Cloud quota cap is the only hard stop and should be set. Paid prices rise on 2027-01-01 and `verify:launch` fails from then until the price table is re-checked | C-5 |
| **Rollback** | Undocumented. Vercel can promote a previous deployment, but migrations are forward-only and the order "migrate, then deploy code that needs it" is unwritten. This release's code does not depend on migration 0080; 0080 only re-enables publishing a build after a scan | F-7 |
| **Dependencies** | Two High production advisories (`undici`, `zod`) were new since the last audit and found by hand. Fixed: `undici` 7.30.1, `zod` bumped. No dependency-update automation or audit step in CI | F-6, F-10 |
| **Platform tier** | Vercel Hobby (non-commercial use) and Supabase free tier (no backups, may pause). Acceptable for unpaid, controlled testing; revisit before charging | F-13 |
| **Status page** | Honest and minimal, but one abandoned run in any workspace turns it amber after 15 minutes, which also false-alarms an uptime monitor keyed on anything but `down` | F-8 |
| **Production checks** | `verify:launch` was not run (reads production configuration). Inferred: email and company-details rows will fail or wait; nothing else blocks a free tester phase except email | F |
| **Certificate** | Valid to 2026-12-19, renewed by Vercel | F |

---

## 9. Exclusions register

| Exclusion | Why | What was and was not touched | Consequence for the release |
|---|---|---|---|
| **Stripe payment infrastructure** | Excluded by David | Not run: checkout, portal, subscription, webhook, price sync. Stripe code was read only. The Subscribe buttons are disabled with no Stripe keys, and production answers the Stripe webhook route with 503 (test key refused), per the previous audit. Billing and tester-access copy was in scope and reviewed (section 7). Fixes A-1 and A-2 touch the terms-acceptance action, the billing page layout and the entitlement remedy text, not Stripe handling | After the three-run trial, a tester continues only through a pilot code or a grant. "Payments not open" messaging was verified on the billing page and the refusal text; the home page and docs name plans without prices. Anything that depends on a live subscription (plan-managed runs, checkout, portal, invoices) is unverified in this audit |
| **Proxy** | The brief mentioned a proxy exclusion; no proxy workstream exists in the repo. David said to skip it | Nothing touched | None. One line recorded here so the brief and the register agree |

---

## 10. External owner-action checklist

For David. Items 1 to 8 gate a GO (section 11). Items 9 to 13 are strongly advised before the first tester. Each item says why.

1. **Run migration 0080 against production.** The code is already deployed and does not depend on it. In a checkout with the production environment: `npm run migrate -- --check`, then `npm run migrate`, then `npm run seed:docs`. Why: without 0080, any tester who runs the exploratory scan can never publish that build (F-1). The index change adds no data and changes no row.
2. **Confirm the Vercel production environment.** `GEMINI_API_KEY` and `NOVERA_MODEL_BUDGET_USD` set (budget defaults to $50), the Groq and Mistral keys present, no Stripe variables set in Production. Redeploy after any change. Why: the third grading vendor and the budget governor depend on them; a test Stripe key in a production deployment fails the launch check.
3. **Set the hard spend cap in Google Cloud for the Gemini key.** Why: the in-app budget governor can overshoot across instances and does not record timed-out calls; the cloud quota is the only hard stop (C-5).
4. **Create an uptime monitor on `https://www.nover.space/api/health`, alerting on a non-200 or a body whose status is `down`. Do not alert on `degraded`.** Why: nobody is told when production breaks (F-2), and `degraded` appears whenever a tester closes a tab on a running run (F-8).
5. **Set `NOVERA_ERROR_WEBHOOK_URL` (a private chat or email webhook) or a Sentry DSN in Vercel, then run `npm run observability:test-event` and confirm the event arrives.** Why: the default sink is the platform log, which keeps about an hour (F-2).
6. **Decide backups.** Open Supabase, Database, Backups and write the plan into `docs/BACKUP-RESTORE-RUNBOOK.md`. If the plan is Free, either move to Pro or schedule an encrypted off-account `pg_dump` at least daily during the tester window from your own machine, and keep `NOVERA_ENCRYPTION_KEY` and the Vercel environment set in a password manager. Write RPO and RTO down (suggested for the tester phase: RPO 24 hours, RTO 1 day). Why: sealed evidence is the product and nothing shows it can be restored (F-3). Ideally run the hosted-restore drill once into a throwaway project.
7. **Prove email end to end.** Sign up once on production with a real external address and confirm that the confirmation, a password reset and an invitation to a test address all arrive. If any fails, tell testers to use Google or GitHub sign-in and fix Supabase custom SMTP before inviting email sign-ups. Why: production email has never been shown to work (F-5). Update rows A1 and O13 of `docs/LAUNCH-READINESS.md`.
8. **GitHub ruleset: require both CI jobs, remove any bypass for the owner, confirm the rule targets the default branch.** Why: six pushes with a red job reached main (F-4).
9. **Decide E-17 with counsel.** Testers' agent replies and policy text reach Groq, Mistral and the paid Gemini vendor unredacted, by design and as documented in the draft provider register. Options: keep the paid vendor at the redacted-customer ceiling until counsel confirms; or confine it to grading only. Also confirm the Gemini processing region in the provider register, which is still marked "to verify". Why: tester data reaching a processor whose location is unconfirmed, before counsel has signed off.
10. **Approve a recalibration run for the new judge prompt fence (real model quota; pace it).** `calibrate` with the eu-support v7 labels, plus an injection set if one exists. Why: the fix for E-2/C-9 changes the judge prompt and the rubric digest for new runs, and was unit-tested only; whether real graders still grade correctly and resist echoed attacks has not been measured. A false pass is the failure consensus exists to prevent.
11. **Count existing production reports affected by D-1.** Read-only query: reports with uncorroborated passes whose methodology sentence says two vendors graded. Decide whether any client needs telling. Why: sealed reports are immutable and keep the wrong sentence; a reissue cannot correct it.
12. **Brief testers.** Keep the run page open until the run finishes and reopen it to resume; stagger large runs (about two at a time); the trial is three runs and a sample run counts; the sample report is withheld on purpose; after the trial, request a pilot at the apply page; results are testing evidence, not a certification; where to report problems. Why: F-8, A-5, capacity, A-2.
13. **Re-run the blocked live attack set under supervision**, or accept the verifier coverage in section 2 and record that you did. Why: Track B's live forged-request testing never ran.

Also for David, with action 1: `npm run seed:docs` against production — the API and GitHub Actions pages changed, and `/docs` (which the support agent answers from) shows the old text until it runs. The decision log and `CLAUDE.md` were updated in `3a04627`.

One consequence of the deploy, by design: a run that was in progress when `3a04627` went live stops with "The grading instructions changed while this run was in progress…" instead of being graded under two rubrics. Rerun it.

---

## 11. Final candidate and release decision

| Field | Value |
|---|---|
| Release candidate commit | `3a04627` and `6f0d47b` (code); this package in the commit after them |
| Deployment | Vercel production, www.nover.space, "Deployment has completed" for `3a04627`; `/api/health` ok, `/`, `/status`, `/verify`, `/sign-in` 200, apex → www 308 (read-only checks, 2026-10-29) |
| Decision | **CONDITIONAL GO** for controlled tester onboarding: the code is ready; the GO waits on owner actions 1–8 |

**Decision rationale:**

*Scope.* Controlled tester onboarding with Stripe deferred. Not an open or paid launch.

*What the audit found.* No Critical findings. Nine High IDs (eight distinct defects): all but two (alerting and backup, which are operational) were product or code defects and are fixed in `3a04627`. The defects that would have misled or stranded a tester were the sealed report that could describe the wrong grading method, the run that completed without a report, the Builder build that could not be published, the false read-back contradiction, and the grader answer that ended a case.

*Conditions for a GO.* All must be true:

1. The final candidate gates in section 5 all pass, including both CI jobs, and `novera report verify` over the live reports.
2. Migration 0080 applied to production and the docs seeded (owner action 1).
3. Alerting is live and has been seen to fire once (owner actions 4 and 5).
4. A backup exists that has been looked at, with RPO and RTO written down (owner action 6).
5. Email proven end to end, or testers explicitly told to use provider sign-in (owner action 7).
6. The GitHub ruleset requires both CI jobs (owner action 8).
7. Paid-model cap set and the production environment confirmed (owner actions 2 and 3).
8. A decision on E-17 recorded, even if the decision is "accept for the tester cohort" (owner action 9).
9. The three open items that are not fixed but would be met first by a tester are either accepted or scheduled: allowance spent on integration-error runs (C-4, C-12), workspace name on the report (A-6), and no written rollback (F-7).

*Conditions that would make it NO-GO.* A failing final gate; a migration or deploy that cannot be rolled forward; email broken with no provider sign-in fallback; a regression found when the real-model recalibration runs (owner action 10).

*Residual risks accepted if GO.* Judge-prompt change not yet measured against real models (unless action 10 is done first); real-model injection behaviour untested; no screen-reader test; no load test beyond the 2026-09-29 data; no hosted restore drill; reports already sealed keep wording that new ones do not; Stripe paths unverified by design.

---

## 12. Prioritised post-tester backlog

All Class C and D items, and the deferred Class B items. P1: before widening beyond a hand-picked cohort. P2: within the first month of testing. P3: when convenient.

**P1**

- C-4: halt a run on a streak of integration errors (auth refused, non-JSON, redirect) and do not charge an allowance for a run with no verdicts.
- C-12: honour an agent's Retry-After once, slow the pace for the rest of the slice, and do not charge a halted run.
- C-10: per-agent tool-name map from discovery; per-case "rule not applicable" note.
- D-5: seal reports under a per-agent lock so the chain cannot fork; add a verifier check for shared previous hashes.
- A-6: ask for the workspace name on welcome.
- F-7: write `docs/setup/deploy-and-rollback.md` (about 15 lines).
- E-17: record the decision and implement the chosen routing ceiling.

**P2**

- C-11 (rest): "last element" response-path syntax; runtime guard against grading the customer's own message or a repeated earlier reply.
- D-7: put the run date in the badge; show age after the link expires.
- E-3 (rest): require trial or entitlement for model work on Novera's keys; move the paid model behind free ones for diagnosis; deduplicate diagnoses.
- E-9: run injection detection on normalised text and on drafted scenario fields; make drafts from a flagged source ineligible for bulk approval.
- E-19: one sentence in the limitations block that model verdicts vary.
- A-5, A-7: sample-report explanation; the three remaining copy items; drive tester-access copy from one billing-open flag.
- F-2 (rest): a self-check that degrades health when a retention job is stale.
- F-8: stop one abandoned run turning the public status amber.
- F-10, F-11: dependency-update automation and an audit step in CI; refresh `.env.example` and the launch-readiness document.
- Route model-error log sites through the error scrubber (F, Observability).
- Founder decision: whether the grade letter should be withheld when corroboration is low (D-1 follow-up).
- Anchor for the seal outside Novera's database; link renewal or a sealed PDF; list of passed scenarios with provenance (D, auditor needs).

**P3**

- A-8: agency first-step wording and sample agent.
- B-4: record the intent of the run-advance route in the permission matrix.
- C-5: record timed-out paid calls.
- C-7 (rest): enumerate remaining IPv6 transition ranges in the address guard tests.
- D-nit-1 to D-nit-4: badge cache comment and max-age; withdrawn-report reason wording; 404 versus 409 consistency; unique index on report content hash.
- E-15: forward routing options in the observed chat helper.
- E-16: delete or route the dormant model-agent path.
- F-9: generate types before typecheck on a fresh clone.
- F-12: favicon, apple icon, security.txt, cache headers for public pages, tracing warnings.
- F-13: move off Hobby and the free database tier before charging.
- Regression checks for A-3 and A-4 (overflow at 390 px with a long name).
- Add a B-1 check to `verify:api`.

---

## Appendix: Method and limits

**Environment.** A local Supabase (Docker) with two app copies of HEAD, each with the model vendor hosts pointed at a local mock model server. Synthetic users only, with placeholder addresses at `novera.test`. Local agent servers served scripted and chaos behaviours. Production was touched only by GET and HEAD requests to public pages, health, status, verify, robots, sitemap, llms.txt and public DNS and TLS reads, at about one request per second. No sign-up, sign-in, form post, run, email or Stripe action was made on production. The production environment file was never used.

**What "VERIFIED WITH MOCKS ONLY" means here.** The behaviour was exercised end to end, but the model vendors were mocks. A normal mock judge passes unless the graded text contains a marker, and other modes return rate limits, errors, timeouts, prose or garbage. This proves the plumbing: how failures, unreadable answers, fallbacks, counts, sealing and surfaces behave. It does **not** measure grading semantics with real models: whether real graders agree, obey text planted in an agent's reply, quote a policy back, or emit unreadable answers at the rate the mock assumes. Nothing in this audit measured the accuracy or stability of real verdicts.

**Limits.**

- No real model calls, so no calibration, no stability measurement, and no measurement of the new judge prompt fence on real models.
- No real email: sign-up, reset and invitation delivery are unproven in production.
- No Stripe flows.
- No screen-reader test. Accessibility evidence is axe-core, keyboard, zoom and reflow checks only.
- No load test. Capacity statements come from the 2026-09-29 throughput measurement and the mechanisms added since; the paid third vendor's throughput is not measured.
- Track B's live forged-request and cross-tenant attack testing was blocked by a safety classifier and not resumed; coverage rests on the project's verifiers and Track D's 17 cross-workspace attempts.
- Vercel, Supabase and GitHub administrative settings (plan, backups, SMTP, cron state, environment variables, ruleset bypass) were not readable.
- Historical report formats were synthesised by removing later fields; no real old rows existed in the local database.
- Some tracks edited the repository while others read it; observations are pinned to what each saw at the time. Track A noted this explicitly.
- The fix status in section 4 comes from `LEAD.md`, plus a read-only check of the working tree for code markers and test files where `LEAD.md` had no row. Test pass results for the fixes are the unit runs reported by the fix groups; the final gate run in section 5 is the confirmation.
