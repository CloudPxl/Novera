# Status page and health check

## `/status` — measured when it loads, plus two lines set by hand

A public page, in the sitemap and the footer. It is server-rendered on every request from the
same function that serves `/api/health` (`src/lib/observability/health.ts`), so the two cannot
disagree. The headline is one of **All systems operational**, **Partial degradation** or
**Service disruption**, with the UTC time of the check. Four measured components:

| Component | Operational when | Degraded / Down when |
|---|---|---|
| Web application and public verification | this page was served and the database answered | the database does not answer: pages are served, `/verify` cannot read a report (Degraded) |
| Database and evidence storage (Frankfurt, eu-central-1) | a head-only read of the built-in suites answered within 1.5 s; the page shows the latency | no answer in time (Down) |
| Evaluation runner | no run has been `queued`/`running` for over 15 minutes with no new case, start or lease | one has (Degraded); not checkable while the database is down (Down) |
| Multi-vendor grading | two or more distinct grading vendors the judge route can use have a key on the server | fewer than two (Degraded). This is configuration, not provider availability, and the page says so |

The page gives no run count, queue depth, vendor name or error text, no uptime percentage and no
SLA. It explains (glossary entry `status_scope`, the `?` beside the line) that an *agent
unreachable* result is about the customer's agent, not Novera, and is recorded as a case error,
never as a failure.

Below the measured list, under "Set by hand, not measured", the page still shows two components a
program cannot see, **Email** and **Scheduled jobs**, plus an optional notice, from
`data/status.json` (or `NOVERA_STATUS_JSON`, same shape; a redeploy applies it):

```json
{
  "updated_at": "2026-10-09T15:00:00Z",
  "notice": "Planned maintenance 2026-10-12 20:00–21:00 UTC.",
  "components": {
    "email":          { "state": "operational", "note": null },
    "scheduled_jobs": { "state": "operational", "note": null }
  }
}
```

Rules enforced by `src/lib/status/status.ts` (tested in `tests/status.test.ts`): a state that is not
one of the four is **Not set**; a file that does not parse shows its components as Not set with a
warning, never as operational; notes are capped at 280 characters and rendered as text. The `app`
and `grading` entries of that file are no longer shown (they are measured now). Email stays
`degraded` while production sends no email (audit 2026-10-08). To update: edit `data/status.json`,
change `updated_at` to now (UTC), commit, push.

Measured 2026-10-16 (local stack, a separate `next dev` copy): HTTP 200; axe-core 0 violations and
0 px horizontal overflow at 390, 1024 and 1440 px; no console errors.

## `/api/health` — status words and one latency

```
GET /api/health  →  200 {"app":true,"database":true,"status":"ok","checked_at":"…",
                         "checks":{"database":{"status":"ok","latency_ms":55},
                                   "runner":{"status":"ok"},"grading":{"status":"ok"}}}
                    503 only when the database is unreachable (status "down")
```

`status` is `ok`, `degraded` (a stalled run, or fewer than two grading vendors; still HTTP 200) or
`down`. `app` and `database` are kept from the first version. There is deliberately **no count**
(stalled runs, vendors configured) and no name, version, region, table or error text: anyone can
call it. The runner's "15 minutes without progress" is read from stored timestamps (`runs.created_at`,
`started_at`, `lease_until`, and the newest `run_cases.created_at`). The answer is reused for 30
seconds per function instance, concurrent callers share one check, and each database read has a
1.5-second deadline, so polling it is not load on the database. `no-store`, and the strict API
headers from `next.config.ts`. This is the address to give an external uptime checker: alert on
anything but HTTP 200, and look at `status` for "degraded".

## Optional: an external status provider (not set up)

If an automatically measured page is wanted later, an external checker can poll
`https://www.nover.space/api/health` (expects HTTP 200) and `https://www.nover.space/status`.
Free tiers that host EU-friendly status pages include Better Stack (Uptime), UptimeRobot and
OpenStatus. Steps, for when that is decided (nothing has been created):

1. Create a monitor: HTTP(S), URL `https://www.nover.space/api/health`, interval 3–5 minutes,
   expected status 200, alert to the operator's email.
2. Optionally a keyword monitor on `https://www.nover.space/` for the home page.
3. If the provider's public page is used, link it from `/status` and change the page's first
   paragraph: from that point part of the page *is* measured, and it must say which part.
4. Add the provider to the sub-processor list (legal item L1) if it receives anything beyond
   these two public URLs.

Do not publish an uptime percentage or SLA on Novera's own pages until there is a contract
term behind it (pricing and terms are undecided).

## `npm run verify:launch` and the staff readiness page

`/readiness` (staff only) opens with **Automated checks (live)**, computed on each request, and the
same list is printed by `npm run verify:launch` (`src/lib/readiness/launch-checks.ts`). Read-only
(selects only); configuration is reported as present or absent, never as a value.

| Check | Passes when | Fix |
|---|---|---|
| Database reachable | a read answers | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Migrations applied | the tables and columns made by 0067, 0068, 0070, 0071 and 0072 exist, and no newer migration file is unprobed | `npm run migrate` (`-- --check` for the ledger) |
| Built-in suites seeded | eu-support v5, eu-gdpr-support v1, e-commerce-refund v1, fintech-kyc v1 | `npm run seed:suites` |
| Documentation seeded | every `data/docs` page is published, with the three integration guides | `npm run seed:docs` |
| Two grading vendors configured | two judge-route vendors have a key | `docs/setup/third-vendor.md` |
| Stripe mode isolation | no key (billing off), or a key billing accepts; a test key on production, or a live key not approved, fails | `docs/BILLING-DECISIONS.md` |
| Email configured / Company details complete | **waiting on a person**, not a fault; shown under Founder sign-off on the page | `docs/setup/sign-in-and-email.md`, `data/legal/entity.ts` |

"Migrations applied" is **inferred**: the migration ledger is closed to every API role by design
(0045), so the check probes for objects the newest migrations created. 0069 only added an index,
which the API cannot see, so it has no probe; `npm run migrate -- --check` is the authoritative
answer. Exit 0 when nothing failed; 1 when something did; `-- --strict` also counts "waiting on a
person" as a failure. Run it against the deployed database from a machine whose `.env.local` points
there, after `migrate`, `seed:suites` and `seed:docs`. A file that is not in a deployment (the
migration or docs directory) is reported as "not available in this deployment" instead of failing
the page.
