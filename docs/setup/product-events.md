# Product events (first-party)

`product_events` (migration 0062) counts the steps between a visit and a sealed report, in
Novera's own database (Supabase, Frankfurt). Nothing is sent to a third party.

## What is stored

| Column | Content |
|---|---|
| `event` | One of eleven fixed names (below); the database refuses any other |
| `workspace_id` | The workspace, when the step happens in one; null otherwise |
| `actor_hash` | HMAC-SHA256 of the signed-in user's id with `NOVERA_EVENTS_SALT`; null when the salt is not set or there is no signed-in person. Never the id, never an email |
| `properties` | A flat object of coarse values from a per-event allow list; at most 1 KB |
| `created_at` | When |

Never stored: user ids, emails, names, IP addresses, user agents, referrers, report tokens,
URLs, policy text, agent content, keys. The application refuses any property not on the
event's allow list (`src/lib/analytics/events.ts`), and the database refuses, again, any
property value shaped like a key (`sk-`, `gsk_`, `nvk_`, `whsec_`, `sk_live_`, `sb_secret_`),
a bearer token, a JWT, an email, or any opaque run of 32+ characters (a report token, a UUID),
and any nested value.

| Event | Properties | Recorded at |
|---|---|---|
| `landing_cta_click` | `placement` (slug) | not wired yet |
| `signup_started` | `method`: email | `src/app/sign-in/actions.ts` → `signUp`, after Supabase accepted the request |
| `signup_confirmed` | `method`: email | `src/app/auth/callback/handle.ts`, a `flow=signup` code exchanged |
| `agent_probed` | `ok` | `src/lib/workflow/run.ts` → `probeAgent` (connect and re-probe) |
| `policy_saved` | `version` | `src/lib/workflow/actions.ts` → `savePolicyVersion` |
| `run_created` | `source` (button, rerun, api, schedule, builder_scan), `judge_source` | `src/lib/workflow/start-run.ts` → `startRun`, after the row is inserted |
| `run_completed` | `cases` (suite size) | `src/lib/workflow/start-run.ts` → `advanceRun`, the slice that marks a run completed (a stopped run is not counted) |
| `report_viewed` | none | `src/app/report/[token]/page.tsx`, a report that is neither expired nor withdrawn. No workspace, no token |
| `report_shared` | `channel` | not wired yet |
| `billing_checkout_started` / `_completed` | `plan` (slug) | not wired yet (Phase 3) |

`api` covers MCP too: both start runs with a workspace key, and `startRun` cannot tell them
apart. Not counted: a policy saved by the Suite Builder, an OAuth sign-up (the callback cannot
tell a first Google/GitHub sign-in from a returning one), a confirmation through the older
`/auth/confirm?token_hash=` links.

## Lifetime

- Append-only: no update, no delete, for any role, except the three exits below.
- **Workspace erasure** (`erase_workspace`, redefined in 0062 with 0056's body plus this table).
- **Account deletion**: `deleteAccount` computes the person's hash and calls
  `erase_product_events_of_actor`. Without `NOVERA_EVENTS_SALT` no event has an actor, so
  there is nothing to find.
- **13 months**: the daily `expire_inbound_and_probes()` pass (job `novera-inbound-probe-expiry`,
  0038) deletes older rows; 0062 redefines that function with 0056's body plus the delete. No
  new cron job; `verify:cron` already checks this one.

## Configuration

| Variable | Effect |
|---|---|
| `NOVERA_PRODUCT_EVENTS=off` | Nothing is recorded |
| `NOVERA_EVENTS_SALT` | At least 16 characters, random (`openssl rand -hex 32`), server-only. Without it events carry no actor (the funnel is counts per step, not per person). Changing it disconnects old events from new ones and makes account deletion unable to find the old ones — they still expire at 13 months |

On by default. Rationale, for the privacy notice (legal item L1) to state: first-party,
aggregate counting of product steps, no identifier stored in clear, no cookie or device
storage, no third party, 13-month retention. Whether this needs consent is counsel's call; it
reads no terminal equipment (no cookie, no local storage, no fingerprint), which is what
ePrivacy Art. 5(3) consent attaches to.

**The consent boundary.** Any third-party analytics or session tool (Plausible, PostHog,
Google Analytics, Hotjar…) is outside this boundary: it sends data to another company, and
most read or write browser storage. Adding one needs, first, a consent decision and banner
where required, a sub-processor entry, a CSP change in `src/proxy.ts` (`script-src` /
`connect-src`), and it must never load on `/report/*`, whose path is the report's access
token.

## Reading the numbers

Service role only (no client can read the table). In the Supabase SQL editor:

```sql
select event, count(*), count(distinct actor_hash) as people
  from product_events
 where created_at > now() - interval '30 days'
 group by event order by event;
```

## Status

0062 is **not applied** anywhere. Until it is, every call logs
`[novera:events] <event> not stored (PGRST205)` and the request carries on. Apply with
`npm run migrate` after merging, then set `NOVERA_EVENTS_SALT` in Vercel.
