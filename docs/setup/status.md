# Status page and health check

## `/status` — set by hand

A public page listing four components — Application, Grading providers, Email, Scheduled
jobs — each **Operational**, **Degraded**, **Maintenance** or **Not set** (unknown), with an
optional note, an optional page-wide notice, and the time it was last updated. Its first
paragraph says the states are set manually, that it is not automated monitoring, and that it
promises no uptime. No SLA or availability figure appears anywhere on it.

The source, in order:

1. `NOVERA_STATUS_JSON` (Vercel env var) if set — for a change without a commit; needs a redeploy.
2. `data/status.json` in the repository — the default; every change is a commit with an author.

Shape (both sources):

```json
{
  "updated_at": "2026-10-09T15:00:00Z",
  "notice": "Planned maintenance 2026-10-12 20:00–21:00 UTC.",
  "components": {
    "app":            { "state": "operational", "note": null },
    "grading":        { "state": "degraded",    "note": "One grading provider is rate-limiting; runs take longer." },
    "email":          { "state": "operational", "note": null },
    "scheduled_jobs": { "state": "operational", "note": null }
  }
}
```

Rules enforced by `src/lib/status/status.ts` (tested in `tests/status.test.ts`):
- A state that is not one of the four is shown as **Not set**; so is a missing component.
- A file that does not parse, or has no valid `updated_at`, shows every component as Not set
  with a warning — never as operational.
- The headline is the worst state present; "Every component is marked operational" appears
  only when all four are.
- Notes are capped at 280 characters and rendered as text, never markup.

**Initial content (needs David's review before the page is public):** email is `degraded`
with a note that confirmation, reset and invitation emails are not delivered yet (the
2026-10-08 audit: Resend variables empty in Vercel); the other three are `unknown` because
nobody has checked production for this file. Set them before linking the page anywhere.

To update: edit `data/status.json`, change `updated_at` to now (UTC), commit, push. Nothing
links to `/status` yet; adding it to the site footer is a one-line change when wanted.

Checked 2026-10-09 (local `next dev`): HTTP 200; axe-core 0 violations and 0 px horizontal
overflow at 390 and 1440 px; no console errors.

## `/api/health` — two booleans

```
GET /api/health  →  200 {"app":true,"database":true,"checked_at":"…"}
                    503 {"app":true,"database":false,"checked_at":"…"}
```

`database` is a head-only count on the built-in suites with a 2-second deadline, reused for 30
seconds per function instance, so polling it is not load on the database. It returns no
version, region, count or error text. `no-store`, and the strict API headers from
`next.config.ts`. This is the address to give an external uptime checker.

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
