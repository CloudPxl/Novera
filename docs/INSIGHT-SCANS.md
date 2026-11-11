# Public-demo insight scans

Staff-only. Novera's browser worker chats with a company's **public** demo chatbot — six fixed
questions, paced, declared as `NoveraInsightBot` — and Novera grades each reply with its AI graders
and computes a short insight card. It is a prospecting tool: the card can open a conversation that
leads to an owner-authorised evaluation, which is the product. Plan and reasoning:
`docs/DECISIONS.md` (2026-11-10, 2026-11-11). Whether this is lawful for third parties is with
counsel (`docs/LEGAL-COUNSEL-QUESTIONS.md`, "Public-demo insight scans").

## What a scan is, and what it is not

- **Never a run, never a report.** Its rows (`insight_targets`, `insight_scans`,
  `insight_observations`, 0082) have no `run_id` and no `report_id`; nothing can seal them.
- **Never the owner's consent.** A target's authorisation basis is `published_public_demo`, recorded
  with the operator's user id and role. The card says the observation was not commissioned or
  endorsed by the company, and that it is not a legal or compliance certification.
- **Classified from facts, never chosen.** `src/lib/insight/classify.ts`: A (public demo: no login,
  money, orders, account changes or refunds), B (public but touches money, orders or accounts:
  needs the owner), C (behind a login: needs authorisation and safe credentials), D (never: the
  owner declined, the site's terms prohibit automated access, or sensitive personal data). Only A is
  ever claimed by a worker; the claim function re-checks it.

## The flow

1. An operator records a target and its facts; the category is derived.
2. "Run automated scan" queues a scan: suite `public-insight` v1 (six single-turn scenarios, kept
   out of `data/suites/` so no run launcher offers it), its digest and scenario ids declared.
   Refused for B, C, D, a do-not-contact target, an active scan, or one less than 24 h old.
3. The worker (`workers/insight-browser/`) claims it. The **server** checks the address is public
   and reads robots.txt for `NoveraInsightBot` first; a refusal ends the scan before any page opens.
4. For each scenario, in a fresh browser session: robots, page, bot-challenge check, one cookie
   acceptance, the widget, a login/payment check, the prompt typed exactly, the reply read until it
   stops changing (at most 45 s), a login/payment check again.
5. The server checks the lease, the 12 s pacing and that the typed prompt is the scenario's input,
   redacts the reply, grades it (rules first, then two AI graders from different vendors, on the
   workspace's funding, recorded as `model_operations.operation = insight_grade`) and stores it
   append-only. No reply, or a reply cut off, is an error row — never a verdict.
6. When every scenario has an observation the scan is `graded`; the card is computed from the rows
   every time it is read (`src/lib/insight/card.ts`).

Ends without a grade, each with its own kind: `robots_disallowed`, `address_refused`,
`target_refused`, `page_load_failed`, `redirected_offsite`, `blocked_challenge`, `widget_not_found`,
`blocked_login`, `blocked_payment`, `lease_expired`, `worker_error`; or `aborted` by an operator.

## Running the worker

Install, configure and run: `workers/insight-browser/README.md`. In short, on the VPS or a Mac:

1. In the repository, with the **deployment's** `NOVERA_ENCRYPTION_KEY` in `.env.local`:
   `npm run insight-worker:secret` — prints the worker's secret once.
2. `cd workers/insight-browser && npm ci && npx playwright install --with-deps chromium`, then
   `npm run insight-worker:build` at the root.
3. Set `NOVERA_BASE_URL`, `NOVERA_INSIGHT_WORKER_SECRET`, `NOVERA_INSIGHT_WORKER_ID`.
4. `node workers/insight-browser/dist/worker.mjs --loop` (a systemd unit is in the README).

The first real-network target should be Novera's own scripted widget,
`https://www.nover.space/api/test-widget?variant=plain`: robots.txt opens that one path to
`NoveraInsightBot` only, and its P03 reply fails on purpose so the card shows a concern.

## Verifying

- `npm test` — classification, gates, protocol, robots, grading, card, worker heuristics, migration text.
- `npm run verify:insight-browser` — the worker bundle in real Chrome against every fixture variant,
  with the real server handlers and an in-memory store (about four minutes, no network, no model).
- The database rules (append-only, forward-only, one active scan per target, a graded scan has every
  scenario) are proved by `tests/insight-migration.test.ts`; on a real database once 0082 is applied.
