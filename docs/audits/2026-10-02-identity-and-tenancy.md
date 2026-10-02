# Identity, tenancy, profiles and memory — architecture audit

*2026-10-02. HEAD `123210a` (main, clean, deployed — the live site serves its content). Local stack:
Supabase CLI 2.118.0, 53 migrations applied from zero. Production read: 2 workspaces, 2 owner
memberships, no other members, no active API keys.*

This audit answers seven questions before anything is built: what exists, what is missing, which
buyer workflow is blocked, which minimum model unblocks it, what stays deferred, what must be
protected, and how to migrate and roll back. The account-mode addendum (personal / agency /
enterprise) is folded in.

## 1. What exists now

| Capability | Exists? | Evidence |
|---|---|---|
| Tenant isolation | **Yes, and strong.** Every tenant table carries `workspace_id`; RLS reads require live membership; every cross-row reference is checked in the database even for the service role | 0001 `is_workspace_member`, 0034 `refuse_cross_workspace()`, `verify:tenancy` |
| Multiple workspaces per user | **Schema only.** `workspace_members` allows it; 0029 deliberately avoided a unique owner index. The session layer never chooses: `requireWorkspace()` takes the oldest workspace RLS returns | `src/lib/auth/session.ts`; probe below |
| Multiple users per workspace | **Schema only.** No invitation, no way to add a member except a service-role write | probe: "no invitation table or flow" |
| Roles and permissions | **Owner/member only**, checked in exactly one place (retention, owner-only). Every other action asks only "is a member" | `src/lib/workflow/retention.ts:26`; grep of `role` |
| Organization / team hierarchy | **No** | no table |
| Workspace / environment separation | **Partial.** `agents.is_production` keeps destructive and fixture-only scenarios off production agents; no staging/production grouping | 0022 |
| Personal user profile | **No.** Name, timezone, preferences — none stored; the UI derives a workspace name from the email | probe: `user_profiles`/`profiles` do not exist |
| Assistant conversation history | **Browser only.** Ask Novera keeps the thread in component state and sends the last turns with each question; nothing is stored | `src/components/shell/assistant.tsx`, `src/lib/assistant/actions.ts` |
| Persistent assistant memory | **No** | probe |
| Audit history | **Evidence-shaped, not an audit log.** Attribution columns (`created_by`, `approved_by`, `revoked_by`, `stopped_by`…), `raw_evidence_reads` (0050), `erasure_log`. No record of membership, role, key or setting changes | catalog |
| Notifications / preferences | **No** (webhooks are workspace integrations, not personal notifications) | — |
| Enterprise administration | **No** (no SSO, SCIM, org admin, billing) | — |
| Self-service erasure | **No UI.** `erase_workspace()` exists and the docs promise erasure, but nothing in the app calls it | grep `erase_workspace` in `src/` |

### The identity path today

```text
auth.users ──(no profile)──► workspace_members(role owner|member) ──► workspaces
   │                                  │
   │                                  └─ RLS: is_workspace_member(ws) on every read
   ├─ session: requireWorkspace() = oldest visible workspace (no choice)
   ├─ API / MCP: api_keys.workspace_id (key-scoped, independent of any user)
   ├─ report link: reports.token (service role; independent of any user or membership)
   ├─ assistant: session reads, unfiltered by workspace; history in the browser only
   └─ staff inbox: NOVERA_STAFF_EMAILS (env list, not a role)
```

### Proof (synthetic users, local stack, `scratchpad/identity/probe-before.mjs`)

```text
CONFIRMED a user cannot add themselves to another workspace — RLS refuses the row
MISSING   no invitation table or flow: the membership needed the service role
LIMIT     requireWorkspace() resolves to the oldest workspace; no switcher or persisted choice
UX        an unfiltered session read (dashboard, top bar, assistant) returns both workspaces' agents
MISSING   roles other than owner/member are refused by the check constraint
LIMIT     a member can rename an agent straight through PostgREST — RLS gates on membership only;
          harmless while "member" is a full operator, a defect the moment narrower roles exist
CONFIRMED a removed member's live session reads nothing from the workspace — 0 rows
SECURITY  an API key created by a member keeps working after that member is removed — HTTP 200
MISSING   deleting a user who ever acted is blocked: evidence columns reference auth.users (restrict)
MISSING   user_profiles, assistant_threads, assistant_memory, audit_events, workspace_invitations
```

What cannot leak today: a person in two workspaces who starts a run with the other workspace's
agent is refused (`startRun` resolves the agent inside the active workspace, and 0034 refuses a
mismatched reference in the database). The defect is the experience — mixed lists, actions that
fail — not a cross-tenant read.

## 2. What is missing, and which buyer workflow it blocks

The home page sells to "agencies and teams who ship AI support agents to clients". Three things an
agency does every week are blocked:

1. **A report per client.** The sealed report's client name is the workspace name
   (`execute-run.ts:143`). An agency testing Client A's and Client B's agents in its one workspace
   hands each client a document headed with the agency's own name. The model key, retention period,
   webhooks and API keys are also per workspace, so two clients cannot have different ones.
   Separate workspaces per client fix all of it — and the session cannot select between them.
   **P0 product-architecture gap.**
2. **A teammate.** There is no way to invite one. A two-person agency shares a password or cannot
   use Novera together. **P1.**
3. **Offboarding.** Removing a person leaves their API keys working. **P1 security** the day
   invitations exist.

A solo engineer is not blocked — but gets an experience written for nobody in particular: no name,
no timezone, no defaults, an assistant that forgets everything on reload.

## 3. Options

| | A — secure single workspaces | B — multi-member, multi-workspace | C — organizations + environments |
|---|---|---|---|
| Migration | profiles only | profiles, roles, invitations, audit events, memory — additive | B + `organizations`, `organization_members`, `workspaces.organization_id`, environment grouping, org-level RLS |
| RLS | none new | role-aware write policies on the 3 client-writable tables; own-row RLS on the new tables | every policy gains an org path; two membership levels to keep consistent |
| UI | profile page | switcher, members & invitations, portfolio view, per-mode dashboards | B + organization admin, environments |
| API / MCP | none | keys still workspace-scoped; removal revokes the member's keys | org-scoped keys, a second key model |
| Erasure | per workspace | per workspace; account deletion pseudonymises the user, keeping attribution | org erasure cascades across workspaces |
| Reports | unchanged, still agency-named | unchanged payload; one workspace per client gives each client its own report | unchanged |
| Packaging value | low | solo / agency / team tiers become possible | enterprise tier |
| Demand evidence | — | the home page's own buyer; the blocked report-per-client workflow | none yet: no enterprise conversation has happened |
| Security risk | lowest | moderate: new write paths, each gated and tested | highest: two levels of membership |
| Timing | now | **now** | after a buyer asks for org-wide admin, SSO or consolidated billing |

**Chosen: B, presented through account modes.** An agency is "one person who owns several client
workspaces and invites teammates into them". That needs no organization table: the portfolio is the
set of workspaces the person belongs to. An organization becomes necessary only for things nobody has
asked for yet — org-wide membership that propagates to every client workspace, consolidated billing,
SSO by domain. Building it now would double every RLS path for no current workflow. Staging and
production stay as they are (the `is_production` agent flag, or a workspace per environment).

## 4. The minimum model

```text
auth.users
  └─ user_profiles (1:1, own-row RLS)      account mode, name, timezone, locale, motion,
     │                                     notifications, onboarding answers, defaults
     ├─ workspace_members (role)           owner · admin · operator · reviewer · auditor
     │    └─ workspace (tenant, unchanged) ← active workspace: a validated cookie, then the
     │                                       profile's default, then the oldest
     ├─ workspace_invitations              hashed token, role, expiry, single use, revocable
     ├─ audit_events                       membership, roles, keys, settings, mode, memory
     ├─ assistant_threads / messages       per user per workspace, retention-bound
     └─ assistant_memory (+ candidates, events)  explicit, scoped, source-linked, deletable
```

One context object resolves every page, action and assistant call:

```ts
type UserContext = { user; profile; accountMode; workspace; role; permissions; memberships };
```

A workspace id from the client (cookie, form field) is never trusted without a membership check.
API and MCP keep resolving the workspace from the key alone, which is already correct.

### Permission matrix

"Client viewer" is deliberately not an in-app role: a client receives the sealed report through its
expiring, revocable link — the path that already exists, is verified, and shows no workspace
internals. "Developer" is an operator; an admin mints their keys. A personal account has one owner,
who holds every permission — the same checks run; they simply all pass.

| Capability | Owner | Admin | Operator | Reviewer | Auditor |
|---|:-:|:-:|:-:|:-:|:-:|
| View dashboard, runs, reports, raw replies in the app | ✓ | ✓ | ✓ | ✓ | ✓ |
| Connect / edit an agent, read-back endpoint | ✓ | ✓ | ✓ | | |
| Save a policy version | ✓ | ✓ | ✓ | | |
| Run a suite, retest, rerun, stop a run, schedules | ✓ | ✓ | ✓ | | |
| Import a suite | ✓ | ✓ | ✓ | | |
| Ask for a diagnosis | ✓ | ✓ | ✓ | ✓ | |
| Approve or reject a diagnosis | ✓ | ✓ | | ✓ | |
| Record own finding; reissue a report with findings | ✓ | ✓ | | ✓ | |
| Draft scenarios; record a production failure | ✓ | ✓ | ✓ | ✓ | |
| Approve / reject scenario drafts; promote into a suite | ✓ | ✓ | | ✓ | |
| Create / revoke API keys (read, run, write) | ✓ | ✓ | | | |
| Grant the `responses` scope | ✓ | ✓ | | | |
| Create / revoke webhooks | ✓ | ✓ | | | |
| Connect or remove the model key | ✓ | ✓ | | | |
| Change retention | ✓ | | | | |
| Withdraw a report | ✓ | ✓ | | | |
| Export a sealed report (link, PDF, JSON, JUnit) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Invite members; change roles; remove members | ✓ | ✓ (not owners or admins) | | | |
| View the audit log | ✓ | ✓ | | | ✓ |
| Erase the workspace | ✓ | | | | |

Reading raw replies is allowed to every role inside the app: RLS cannot hide one column from one
role without views over every evidence table, and a read-only auditor who cannot read the evidence
is not auditing. The `responses` restriction stays where it matters — on keys that leave the app.

### Onboarding answer map

Three questions, each with an effect. Nothing is asked for research.

| Question | Answer | Stored | UI effect | Workflow effect | Ask Novera | Upgrade trigger |
|---|---|---|---|---|---|---|
| Who is this for? | Just me (engineer, founder, consultant) | `account_mode = personal` | "My agent / My runs" language, no switcher, no members | connect-first checklist | plain, technical | "Invite a teammate or add a client" |
| | An agency or consultancy | `account_mode = agency` | workspace switcher, clients portfolio, members | one workspace per client; report handoff | agency terms ("client", "handoff") | second member or second workspace |
| | A company team | `account_mode = enterprise` | governance panel: roles, audit log, retention, raw reads | approval and audit path | governance terms | — |
| First goal | Test my own agent | `primary_goal = own_agent` | primary action "Connect your agent" | — | agent-testing guidance | — |
| | Deliver agents to clients | `primary_goal = client_delivery` | primary action "Add a client workspace" | release gate and report handoff surfaced | client handoff | agency mode suggested |
| | Internal assurance | `primary_goal = governance` | primary action "Connect an agent", readiness first | report-readiness path | governance | enterprise mode suggested |
| Channels | Web chat / API | `channels` | HTTP connection guidance | — | HTTP examples | — |
| | Voice or phone | `channels` | an honest note: Novera tests HTTP endpoints; voice is not supported | — | says so | — |
| | Email | `channels` | note: test the text agent behind it over HTTP | — | says so | — |

## 5. Assistant history and memory

Today: no threads, no messages, no memory. Citations exist per answer (doc slugs), the snapshot is
workspace data without secrets or policy text, keys typed into a question are refused before any
model call, and every answer names who funded it. Prompt injection is bounded because the assistant
can only link to this workspace's paths and offer a run the person presses.

Design (built):

- **`assistant_threads` / `assistant_messages`** — per user, per workspace; the user's own rows
  only (a teammate cannot read your conversation); citations stored with each answer; erased with
  the workspace, deleted with the account; emptied after 180 days without activity by the existing
  daily pass.
- **`assistant_memory`** — `scope` personal or workspace, a fixed set of `key`s (timezone, language,
  default agent, default suite, review lens, report style, explanation length, terminology), a
  bounded value, `source` (`settings`, `user_said`, `approved_candidate`), the source message,
  `expires_at`. Created only by a person's action. Values are scanned for key-shaped and
  credential-shaped text and refused. Never read by grading, scheduling, reports or policy code.
- **`assistant_memory_candidates`** — the model may *suggest* one; it is shown with a Remember
  button and stored as a candidate. A candidate never becomes memory without the click. A candidate
  whose source message contained an instruction-shaped injection is dropped.
- **`assistant_memory_events`** — folded into `audit_events` (`memory.created`, `memory.deleted`,
  `memory.cleared`) so there is one audit trail, not two.

## 6. What must be protected

Sealed report payloads and hashes (no payload change in this work); every evidence invariant
(append-only, cross-workspace refusal, trial cap); existing workspace ids, agents, runs, keys and
policies; the two production owners' access; API keys and MCP (still workspace-scoped, unchanged
auth); the rule that personalization never reaches grading, suites, policy evaluation or reports.

## 7. Migration and rollback

One forward-only, additive migration (0054):

- `workspace_members.role` check widened to owner/admin/operator/reviewer/auditor; existing
  `member` rows become `operator` (production has none).
- New tables, each with RLS and its erasure path in the same migration: profiles (user-scoped,
  removed on account deletion; workspace references `on delete set null`), invitations, audit events
  (workspace events erased with the workspace, leaving `erasure_log`), threads, messages, memory,
  candidates.
- Role-aware write policies on the three client-writable tables.
- `erase_workspace()` redefined to name the new tables, keeping 0005's exemption chain.
- Nothing dropped, nothing renamed, no payload touched.

Rollback: the migration is additive; the previous application ignores the new tables, and the
widened role check accepts every value the old code writes. Reverting the code is a redeploy of
`123210a`. The one non-additive step — `member` → `operator` — affects zero production rows.

## Appendix — every table today

Generated from the local schema (`scratchpad/identity/catalog.mjs`). "After removal" means a member
who has been removed; "API/MCP key" lists what a workspace key can reach.

| Table | PK | Workspace | User refs | RLS (client) | Mutation guard | Erasure | Retention | After removal | API/MCP key | Report token |
|---|---|---|---|---|---|---|---|---|---|---|
| `agents` | id | yes | attested_by | agents_select(SELECT), agents_insert(INSERT), agents_update(UPDATE) | — | named in erase_workspace | — | no — RLS reads live membership | read (list) | no |
| `api_keys` | id | yes | created_by,revoked_by | api_keys_select(SELECT) | api_keys_revoke_only | named in erase_workspace | — | no — RLS reads live membership | authenticates by hash | no |
| `case_retests` | id | yes | created_by,settled_by | case_retests_select(SELECT) | case_retests_immutable | named in erase_workspace | daily pass | no — RLS reads live membership | no | no |
| `diagnoses` | id | yes | decided_by,requested_by | diagnoses_select(SELECT) | — | named in erase_workspace | — | no — RLS reads live membership | write (MCP proposals) | no |
| `doc_pages` | id | — | — | doc_pages_select(SELECT) | — | n/a (public docs) | — | n/a | no | no |
| `erasure_log` | id | yes | requested_by | on, no policy (service only) | — | named in erase_workspace | — | no — RLS reads live membership | no | no |
| `evidence_observations` | id | yes | — | evidence_observations_select(SELECT) | evidence_observations_immutable | named in erase_workspace | — | no — RLS reads live membership | read (in get_run) | no |
| `inbound_erasure_log` | id | — | requested_by | on, no policy (service only) | — | n/a (staff inbox) | — | n/a | no | no |
| `inbound_requests` | id | — | — | on, no policy (service only) | — | n/a (staff inbox) | daily pass | n/a | no | no |
| `judge_calibrations` | id | — | — | on, no policy (service only) | — | n/a (Novera-internal) | — | n/a | no | no |
| `novera_migrations` | name | — | — | on, no policy (service only) | — | n/a (migration runner only) | — | n/a | no | no |
| `policies` | id | yes | created_by | policies_select(SELECT) | policies_immutable | named in erase_workspace | — | no — RLS reads live membership | no | no |
| `probes` | id | yes | — | probes_select(SELECT) | probes_immutable | named in erase_workspace | daily pass | no — RLS reads live membership | no | no |
| `production_failures` | id | yes | created_by | production_failures_select(SELECT), production_failures_insert(INSERT) | production_failures_immutable | named in erase_workspace | — | no — RLS reads live membership | write | no |
| `raw_evidence_reads` | id | yes | — | raw_evidence_reads_select(SELECT) | — | cascade from workspaces | — | no — RLS reads live membership | written on each raw read | no |
| `reply_drafts` | id | — | approved_by | on, no policy (service only) | reply_drafts_forward_only | n/a (staff inbox) | daily pass | n/a | no | no |
| `reports` | id | yes | revoked_by | reports_select(SELECT) | reports_revoke_only | named in erase_workspace | — | no — RLS reads live membership | read (link) | yes — the sealed payload, until expiry or withdrawal |
| `request_throttle` | identifier+window_start | — | — | on, no policy (service only) | — | n/a (rate limits) | — | n/a | no | no |
| `run_cases` | id | yes | settled_by | run_cases_select(SELECT) | run_cases_immutable | named in erase_workspace | daily pass | no — RLS reads live membership | read; raw only with responses | no |
| `run_requests` | workspace_id+idempotency_key | yes | — | on, no policy (service only) | — | cascade from workspaces | — | no — RLS reads live membership | run (idempotency) | no |
| `run_schedules` | id | yes | created_by,cancelled_by | run_schedules_select(SELECT) | — | named in erase_workspace | — | no — RLS reads live membership | no | no |
| `runs` | id | yes | created_by,stopped_by | runs_select(SELECT) | — | named in erase_workspace | — | no — RLS reads live membership | read; run/write start | no |
| `scenario_drafts` | id | yes | approved_by,rejected_by,created_by | scenario_drafts_select(SELECT), scenario_drafts_insert(INSERT), scenario_drafts_update(UPDATE) | scenario_drafts_forward_only | named in erase_workspace | — | no — RLS reads live membership | write (MCP drafts) | no |
| `secrets` | id | yes | — | on, no policy (service only) | — | named in erase_workspace | — | no — RLS reads live membership | no | no |
| `suites` | id | yes | — | suites_select(SELECT) | — | named in erase_workspace | — | no — RLS reads live membership | read | no |
| `verdict_reviews` | id | yes | reviewer_id | verdict_reviews_select(SELECT) | verdict_reviews_immutable | named in erase_workspace | — | no — RLS reads live membership | read (in get_run) | no |
| `webhook_deliveries` | id | yes | — | webhook_deliveries_select(SELECT) | — | named in erase_workspace | — | no — RLS reads live membership | no | no |
| `webhook_endpoints` | id | yes | created_by,revoked_by | webhook_endpoints_select(SELECT) | webhook_endpoints_revoke_only | named in erase_workspace | — | no — RLS reads live membership | no | no |
| `workspace_members` | workspace_id+user_id | yes | user_id | wsm_select(SELECT) | — | named in erase_workspace | — | no — RLS reads live membership | no | no |
| `workspaces` | id | — | owner_id | ws_insert(INSERT), ws_select(SELECT) | — | named in erase_workspace | daily pass | no (owner or member only) | no | no |
