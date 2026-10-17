# Billing: what is built, what is proposed, what David decides

Phase 3 of the launch program (`docs/LAUNCH-READINESS.md`, P1–P5). Written 2026-10-09.

**State: sandbox only, prices approved, runs gated (D3).** Checkout and the portal turn on only
when Stripe *test* keys are configured, and live keys are refused. Since 2026-10-12 (0067) billing
**decides whether a run may start**: the trial is the whole free tier, three runs per account
owner, and after it every run needs a subscription or a manual grant, whether or not the workspace
has its own key. Fair use applies on every plan. The plan prices were approved by David on
2026-10-12 (§2) and are shown on Settings → Billing (`/billing`). Nothing can be bought live until
the §7 live checklist is done. Until billing opens, a workspace past its trial runs only under a
manual grant. Nothing here is a sales term or legal advice.

---

## 1. What is implemented

### The shape

| Piece | Where | What it does |
|---|---|---|
| Config | `src/lib/billing/config.ts` | Billing is *not active* unless `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are both set. `sk_live_`/`rk_live_` is refused unless `BILLING_ALLOW_LIVE=1`. A publishable key is refused. Tax flags default off. |
| Plan catalog | `src/lib/billing/plans.ts` + `billing_plans` (0060, 0066) | Team BYOK and Agency Pro: approved list price (EUR, monthly), runs on your own key (unlimited) and on Novera's keys (0 / 100), features. Every plan is `draft`; the table's check constraint allows only `draft`/`disabled`. A test holds code and migrations together. |
| Price allow-list | env `STRIPE_PRICE_TEAM_BYOK`, `STRIPE_PRICE_AGENCY_PRO` | Plan key → Stripe price id, server-side. The browser sends a plan key only; a price id, customer id or workspace id in a form is never read. A Stripe price not on the list maps to *no plan* and grants nothing. |
| Schema | `supabase/migrations/0060_billing.sql` | Customers, subscriptions + history, manual grants, webhook ledger, billing audit trail, plans. Details below. |
| Webhook | `src/app/api/stripe/webhook/route.ts` → `src/lib/billing/webhook.ts` | Raw body, signature check, idempotent per event id, out-of-order safe, workspace mapping, cross-workspace refusal. |
| Entitlement | `src/lib/billing/entitlement.ts` | Pure function merging grant / subscription / own key / trial. Tested. |
| Checkout, portal, cancellation | `src/lib/billing/actions.ts` (server actions), `checkout.ts`, `stripe-gateway.ts` | Owner/admin only (`billing.manage`). Stripe-hosted Checkout and Customer Portal; cancel at period end and undo. |
| Page | `src/app/(app)/settings/billing/page.tsx` | Entitlement source, server-computed runs, subscription standing, portal button only when configured, sandbox banner, truthful "not active" state. No prices. |
| Tests | `tests/billing.test.ts`, `tests/billing-fakes.ts` | 23 tests, offline. Signatures are made with `Stripe.webhooks.generateTestHeaderString`; Stripe is an in-memory fake. |

### Database (0060)

| Table | Holds | Mutability | Client access |
|---|---|---|---|
| `billing_plans` | plan key, name, runs per period, `draft`/`disabled` | normal (server) | none |
| `billing_customers` | workspace ↔ `cus_…`, mode, who created it | frozen (`refuse_mutation`) | SELECT owner/admin |
| `billing_subscriptions` | Stripe status, plan key, price id, period, cancel flags, `delinquent_since`, `stripe_observed_at` | trigger: ids/workspace/mode frozen; `stripe_observed_at` never moves back; `canceled`/`incomplete_expired` terminal; customer must be the same workspace's | SELECT any member |
| `billing_subscription_history` | every state written | append-only | SELECT owner/admin |
| `billing_entitlement_grants` | manual grants: kind, plan, runs, window, **reason**, **granted_by** | terms frozen; revoked once with reason; unmetered only for `internal` | SELECT any member |
| `billing_webhook_events` | event id (PK), type, mode, status, attempts, short detail | forward-only status; finished rows frozen | none |
| `billing_events` | billing audit trail (Stripe-, member- and staff-originated) | append-only | SELECT owner/admin |

No card data, address, email, invoice, amount, webhook payload or Stripe secret is stored.
No INSERT/UPDATE/DELETE grant for `anon`/`authenticated` (0057's lesson); the server writes
with the service role after its own role check. Every table has its path in
`erase_workspace()` (0056's body kept line for line — a test checks — plus six deletes).
Verified on the local stack inside a rolled-back transaction: 27 refusals and RLS reads as
operator, owner and another workspace's owner, then erasure removed every billing row of
the erased workspace and nothing of the other.

### The webhook, rule by rule

1. Billing off → 503. No signature, a wrong secret, a changed body, or a timestamp older than
   300 s → 400, nothing written.
2. Event mode (live/test) must match the configured key's.
3. The event id is claimed in `billing_webhook_events`. Finished → 200 `duplicate`. Being
   handled → 409 (Stripe retries). Failed, or a claim abandoned for 5 minutes → claimed again.
4. **Ordering.** Stripe does not order events and says not to order by `created`. So the
   handler never writes from the snapshot when it can ask: it retrieves the subscription and
   writes Stripe's current state with the fetch time. A late, older event therefore re-reads
   the present. The database refuses an older `stripe_observed_at` and any change to a
   canceled subscription anyway.
5. **Mapping.** A Stripe object reaches a workspace only through `billing_customers`, which
   Novera wrote when it created the customer. A session whose `client_reference_id` or
   metadata, or a subscription whose metadata, names another workspace is refused and logged
   in the customer's workspace. An unknown customer is refused.
6. **No grant from the browser.** `?checkout=returned` and `?portal=returned` choose a
   sentence on the page and nothing else (tested by reading the page source).
7. **Nothing is deleted** on any subscription change. The most a change does is stop a plan
   from counting.

Events handled: `checkout.session.completed`, `customer.subscription.created|updated|deleted|paused|resumed`,
`invoice.paid`, `invoice.payment_failed`. Everything else is recorded as `ignored`.

### Entitlement schema (the one default)

**Per-workspace subscription with a run allowance per billing period.** Not per seat.

Why:

- **The buyer is an agency, and a workspace is a client.** Since 0054 an agency opens one
  workspace per client. A subscription per workspace maps one-to-one onto what the agency
  resells and invoices onward; erasure, retention and evidence are already per workspace.
- **Runs are the cost.** A run spends model quota (ours on the trial, the customer's on
  BYOK) and runner time. Seats cost Novera nothing.
- **Seats punish the right behaviour.** Reviewers and auditors — often the agency's client
  or an assessor — are who a conformity report is for. Charging for them discourages
  exactly the review the product exists to enable.
- It matches `docs/COMPETITION.md`: price a verified run, not model calls or people.

Rules (`resolveEntitlement`): a source is *in force* or not; sources do **not** add up — the
first in-force source with room wins, in the order **manual grant → subscription → trial**
(the old "own key, unmetered" source applies only with `byokRequiresPlan: false`, which no
deployment uses since D3). A plan counts two kinds of run differently: with a model key connected,
runs on that key are **unlimited** (counted, never capped); without one, only the plan's
**managed** allowance applies — runs graded on Novera's keys under the plan
(`judge_source = 'plan_managed'`, 0067), 0 on Team BYOK, 100 a period on Agency Pro. The trial
runs on the workspace's own key when it has one, and on Novera's keys otherwise. If none has room,
the highest in-force one says why, and the refusal names its kind (`blocker`) so every surface
offers the same next step (`src/lib/billing/remedy.ts`): choose a plan, connect a key, wait for a
run in progress, or contact support. Allowances are windows over
the same `runs` rows, counted, never estimated. Grace: a `past_due` subscription keeps its
plan for `BILLING_GRACE_DAYS` (default 7) from the first failure of that delinquency, then
is *restricted*; `unpaid` is restricted at once. Restricted or nothing in force: no new
runs, every run/case/report stays readable and exportable.

### Run gating (0067, 2026-10-12)

- **One decision for every entry point.** `workspaceEntitlement` (`src/lib/auth/entitlement.ts`)
  feeds `resolveEntitlement` the stored rows with `byokRequiresPlan: true`, and `startRun` refuses a
  run it does not fund. The button, rerun, the API, MCP, a schedule and a Suite Builder scan all
  pass through `startRun`. The top bar, dashboard, agent page, run launcher and Settings read the
  same answer, so none of them offers a run that would be refused.
- **A run names what pays for it.** `runs.funded_by_subscription` (Stripe subscription id) or
  `runs.funded_by_grant`, or neither for a trial run. Both are frozen with the run's attribution,
  and so is `judge_source`. 0067's trigger checks that the subscription or grant belongs to the
  run's workspace and is in force (subscription `active`/`trialing`/`past_due`; the application
  applies the grace period on top). It also counts, under a per-workspace lock:
  - a plan's managed runs in its current period, refused past the allowance;
  - a grant's runs, refused past `runs_allowed`.
- **Plan-funded grading is not the trial.** `judge_source = 'plan_managed'` is graded on Novera's
  keys, shares the trial's two grading slots (`claim_run_slice_fenced`), and the report says
  "Grading funded by Novera, under the workspace's plan". The trial cap (0055) is unchanged and
  stays atomic per owner.
- **Fair use, every plan** (`src/lib/billing/limits.ts`, mirrored in 0067): at most **3 runs in
  progress** per workspace and at most **1,000 runs in any 30 days**.
  - The API answers both with status 429 and `code: "concurrency"` or `code: "fair_use"`.
  - A schedule meeting the in-progress limit skips that occurrence and is not paused.
  - A retest re-grades inside an existing run, so fair use does not refuse it; funding does.
  - Measured locally: of 12 concurrent starts, exactly 3 were accepted. The 101st managed run of a
    period and the 1,001st run in 30 days were refused.
- **Before billing opens**, a workspace past its trial runs only under a manual grant (below). The
  billing page says to contact support for a pilot.

### A run aborted before any scenario is free (0074, 2026-10-17)

- **Decision (David, 2026-10-17):** a run that is superseded or stopped before it executes costs
  nothing. A run stopped by a person, superseded by a newer commit (`ci_triggers`), ended by a slice
  failure, or stopped by the 24-hour idle sweep **before it recorded any scenario** uses none of the
  trial's three runs, a grant's units, or a plan's managed allowance.
- **Why:** such a run never reached the agent and produced no evidence; charging it punishes the
  behaviour we want (cancelling a pipeline run its newer commit replaced, stopping a run started by
  mistake). A CI branch pushed three times in a minute spent two trial runs on nothing.
- **The rule**, identical in SQL and TypeScript: a run counts unless
  `status = 'aborted' and not exists (select 1 from run_cases where run_id = runs.id)`.
  - A queued or running run counts — it holds its place while it can still execute, which is
    what keeps 12 racing starts at 3. If it is then aborted empty it stops counting, and a new start
    is allowed; that is intended.
  - A completed run counts. An aborted run with at least one recorded scenario counts — including a
    run halted after three transport failures, which records those failures as case errors (it
    reached the agent), and a run whose in-flight scenario was saved after Stop (0043 lets an
    aborted run take rows).
- **Where:** 0074 redefines `runs_trial_cap()` (per-owner lock) and `runs_fair_use_and_funding()`
  (per-workspace lock; the grant count and the managed-period count) with the exclusion, and adds
  the computed column `counts_against_allowance(runs)`. The application filters on it in
  `workspaceEntitlement` (trial) and `loadBillingRows` (grant and managed windows,
  `src/lib/billing/allowance.ts`), so the badge, Settings, Billing, the dashboard, the agent page
  and every refusal show the numbers the database enforces. Locks and lock order are unchanged.
- **Fair use is unchanged and counts every start**, an empty aborted one included: 3 in progress
  and 1,000 per 30 days are rate and abuse limits, not allowances. A person or pipeline that starts
  and stops runs in a loop still meets them.
- **Rows are unchanged.** Runs, their status and their frozen funding stay as written; only the
  counting changed. The run page says "This run recorded no scenario, so it does not count against
  your runs." on an aborted run with no recorded scenario.

### Deliberately not done yet

- **Erasing a workspace while Stripe could still charge** (active, trialing, past due — in
  grace or restricted —, unpaid, incomplete, paused, unless set to end) is refused, with the
  sentence to show (`subscriptionBlocksErasure`, `subscriptionMayCharge`). Erasure never
  cancels at Stripe on its own: cancelling immediately, and any refund, is a person's decision.
- **Preview and production share one database.** Every reader takes only the configured mode's
  rows (`storedLivemode`: the key's mode, live when billing is off), and since 0065 a workspace
  may hold one Stripe customer per mode. A sandbox subscription therefore never shows in
  production, never blocks erasure there and never blocks a later live checkout. The sandbox
  rows themselves stay (the tables are frozen) until the workspace is erased: run sandbox tests
  in a throwaway workspace.
- **No UI for manual grants.** The table, its rules and RLS exist; grants are inserted by
  an operator with the service role (reason and `granted_by` required by the database). Since
  D3 this is how a workspace keeps running before billing opens, for example a 30-day pilot of 50
  runs:

  ```sql
  insert into billing_entitlement_grants (workspace_id, kind, runs_allowed, ends_at, reason, granted_by)
  values ('<workspace id>', 'pilot', 50, now() + interval '30 days', 'Pilot before billing opens', '<your user id>');
  ```

  `kind = 'internal'` with `runs_allowed = null` is unmetered (Novera's own workspaces). With its
  own key the workspace grades on that key; without one, on Novera's keys as `plan_managed`.
- `workspaces.plan` (`trial`/`paid`, 0001) is unused and left alone.
- No billing email from Novera — see section 6.

---

## 2. Plan catalog (prices approved 2026-10-12)

| Plan key | Name | Price | Runs on your own model key | Runs graded on Novera's keys | For |
|---|---|---|---|---|---|
| — | Trial | free | — (a key ends the trial) | 3 per account owner, across owned workspaces | a first sealed report |
| `team_byok` | Team BYOK | **€99 / month** | unlimited | none | agencies and dev teams grading on their own key |
| `agency_pro` | Agency Pro | **€299 / month** | unlimited | 100 per billing period, no rollover | agencies delivering several client agents, with Novera-funded multi-model consensus |
| — | Pilot / support / internal | no charge | per grant | per grant | manual grant |

**Commercial rationale.**

- **Price the evidence, not the people.** A subscription is per workspace (one per client in an
  agency), never per seat: reviewers and auditors are who a report is for (§1).
- **Team BYOK — €99.** The customer pays its own model provider, so Novera's cost per run is
  runner time only; unlimited runs on the customer's key cost Novera little and remove the
  reason to ration testing. €99 sits inside the €79–149 research anchor (`docs/COMPETITION.md`)
  for a team tool that produces client-ready evidence.
- **Agency Pro — €299.** The difference is grading Novera pays for: two models from different
  vendors on Novera's keys, without the customer holding provider accounts. 100 managed runs a
  month covers weekly re-evaluation of a handful of client agents (5 agents × 4 weekly runs = 20)
  with headroom for release gates and retests. €299 is the bottom of the €299–499 anchor.
- **Trial — 3 runs.** Enough for a first sealed report and a comparison, funded on free-tier
  keys (0049, 0055: per owner, across workspaces, race-safe).

**Where the catalog lives.** `PLAN_CATALOG` (`src/lib/billing/plans.ts`) and `billing_plans`
(0060, prices and allowances from 0066) — a test fails if they disagree. Stripe holds the price
that is charged; the catalog holds the price that was approved, which the billing page shows.
**Checkout reads the allow-listed Stripe price first and refuses one that is not exactly the
catalog's amount, currency and monthly interval** (`priceMismatch`, `src/lib/billing/checkout.ts`),
so the page can never show €99 while Stripe charges something else. The browser sends a plan key
only; never a price, an amount, a customer or a workspace.

**What the catalog does since 0067:**

- **Agency Pro's 100 managed runs can be spent.** A workspace without its own key and with Agency
  Pro in force grades on Novera's keys as `plan_managed`, counted against the period's 100 under a
  lock. **Still needed before selling it live:** a funded grading budget, 100 runs × the number of
  Agency Pro workspaces. Today's keys are free tiers measured at one clean run at a time.
- **Team BYOK now sells something.** After the trial, a workspace with its own key needs a plan to
  run (D3). The home page and `/docs/the-trial-and-your-own-key` say so instead of "nothing to pay
  us". They name the plans, not the prices, because the prices are not published until billing
  opens.

## 3. Decisions David must make

| # | Decision | Default in code until then |
|---|---|---|
| D1 | Prices, currency, interval — **decided 2026-10-12:** €99 / €299 a month, EUR, monthly only. **Open:** VAT-inclusive or exclusive display (accountant) | the page shows the list price and says VAT is confirmed before billing opens |
| D2 | Does any paid plan grade on Novera's keys? — **decided 2026-10-12: yes, Agency Pro, 100 a period.** `plan_managed` and its count in 0067 | spendable; needs a funded grading budget before live |
| D3 | Does a BYOK workspace **without** a plan keep unmetered runs? — **decided 2026-10-12: no.** The trial (3 runs per owner, on any key) is the whole free tier; after it every run needs a plan or a grant. Public copy changed. A fair-use limit applies on every plan: 3 runs in progress, 1,000 per 30 days | `byokRequiresPlan: true`, enforced by `startRun` and 0067 |
| D4 | Run allowances — **decided 2026-10-12:** unlimited on your own key on both plans; managed runs 0 / 100 a period; no rollover | as decided |
| D5 | Grace period length after a failed payment | 7 days |
| D6 | Stripe "after all retries fail" setting: cancel, mark unpaid, or leave past_due | code handles all three |
| D7 | Free trial on a paid plan (Stripe `trialing`) or only the 3-run trial | 3-run trial only |
| D8 | Upgrades/downgrades: proration on or off; downgrades at period end | Stripe portal defaults |
| D9 | B2B only, or also consumers (see §4) | B2B intended |
| D10 | Whether to gate features (API, MCP, schedules, webhooks) by plan | nothing gated; all plans list all features |

---

## 4. Legal, tax and accounting review items (lawyer + accountant)

Not legal or tax advice. Each needs a qualified answer before live activation.

1. **B2B only vs B2C.** Selling only to businesses simplifies VAT (reverse charge) and
   removes most consumer-law duties, but must be enforced: Checkout's tax-ID collection
   (`BILLING_TAX_ID_COLLECTION=1`, `tax_id_collection[required]=if_supported` would need a
   code change) and terms that say so. Stripe only checks the *format* of a tax ID; EU VAT
   numbers are verified asynchronously and the result is ours to act on.
2. **Entity, country, VAT registration.** Which legal entity sells, in which country, and its
   VAT number. Stripe Tax needs head-office address and registrations configured.
3. **Prices with or without VAT.** B2B in the EU is normally quoted net; B2C must show gross.
4. **OSS / registrations.** B2C digital services to other EU states: VAT at the customer's
   rate, usually via the One-Stop Shop; the €10,000 EU-wide threshold. Non-EU customers
   (UK, CH, US states) have their own rules. Stripe Tax monitors thresholds but does not
   register for you.
5. **Invoicing responsibility.** Stripe issues invoices and receipts; the accountant confirms
   they meet the seller country's invoice requirements (sequential numbering, seller VAT
   number, reverse-charge wording). Novera stores no invoice.
6. **Cancellation and refunds.** Proposed: cancel any time, effective at period end, no
   pro-rata refunds; failed payments get the grace period. Needs to be in the terms.
7. **Consumer right of withdrawal (14 days) for digital services.** Applies only if B2C. Starting
   the service immediately requires the consumer's express consent and acknowledgement of
   losing the right; Checkout does not collect that by default (`consent_collection` /
   custom text would be needed). Avoided entirely by B2B-only.
8. **Currencies.** EUR only proposed; multi-currency needs prices per currency in Stripe.
9. **DPA roles.** For billing data Stripe is an independent controller for payments and a
   processor for some Billing features — confirm and list Stripe as sub-processor
   (Phase 4 L1). Novera is processor for the customer's evidence, controller for its own
   billing relationship.
10. **Record retention.** Accounting law requires keeping invoices for years; they live in
    Stripe. Confirm that erasing a workspace (which deletes Novera's billing rows) is
    compatible, given Stripe retains the financial records.
11. **Sign-off.** Accountant and lawyer sign off items 1–10 before P5.

### The founder's memo of 2026-10-16: figures to confirm (internal only)

`docs/legal/2026-10-16-founder-memo.md` gives these positions. They are the memo's figures, recorded
here so the accountant can confirm or correct them. **Per the founder's memo, to be confirmed by the
accountant/counsel.** None is shown on a public page, and none changes the code.

- **Entity and income tax:** an SRL. Micro-enterprise tax of 1% of turnover while annual revenue stays
  under EUR 100,000 (the memo says this needs at least one employee, who can be the founder-administrator);
  16% profit tax above that; 16% dividend tax.
- **VAT registration:** mandatory once domestic turnover exceeds RON 395,000 (about EUR 73,930).
  *To check:* a non-registered Romanian company supplying B2B services to other member states appears
  to need a special VAT registration (Fiscal Code Art. 317) before the first such supply, whatever its
  turnover. The memo also cites Fiscal Code Art. 307(2), which concerns a Romanian *recipient*; for
  Novera's outbound sales the place-of-supply rule (Art. 278(2)) looks like the relevant one.
- **Intra-EU B2B reverse charge:** invoices to a VAT-registered business in another member state state
  "Reverse charge — VAT to be accounted for by the recipient (Art. 196 Council Directive 2006/112/EC)".
- **OSS:** not used while Novera sells to businesses only.
- **Accounting retention:** 5 to 10 years (Law 82/1991), overriding an erasure request for invoices,
  transaction logs and billing ledger rows. *Gap:* `erase_workspace()` deletes Novera's own billing rows
  and contract acceptances today (item 10 above; the proposed migration is in
  `docs/LEGAL-COUNSEL-QUESTIONS.md`, "Retention gap"). Unchanged until the accountant names the records
  and periods.
- **VIES:** accountant review of automatic VIES validation, the reverse-charge annotation and non-EU
  billing before Stripe live.

### Pre-live tax tasks (from the memo)

1. **Reverse-charge wording on invoices.** Not wired. The natural hook is the Stripe customer's
   `invoice_settings.footer`, set when `createCustomer` runs (`src/lib/billing/stripe-gateway.ts`), for a
   customer whose acceptance names another EU country and a VAT number. It is deliberately not built:
   the VAT number is recorded as declared and never validated, and stamping "reverse charge" on an
   unvalidated number is the VIES question itself. Stripe Tax (with tax-ID collection) can add the
   reverse-charge note itself once registrations are configured. The accountant chooses between the
   two; then one code change, with a test that the note appears only for another EU state with a
   validated VAT number.
2. **VIES validation** before any invoice relies on a VAT number. `vat_id_verified` stays false (0068)
   until a real validation exists, and Novera never calls a number validated.
3. **Art. 317 registration** (if the accountant confirms it) before the first sale to another member
   state.
4. **Retention:** the migration in the counsel file, once the accountant names records and periods.

---

## 5. Stripe dashboard configuration (sandbox first)

1. Create a **sandbox** in the Stripe dashboard. Use only its `sk_test_…` key.
2. **Products and prices**: one product per plan key, one recurring monthly price each, in
   EUR, at exactly the catalog's amount: Team BYOK €99.00, Agency Pro €299.00 (licensed, every 1
   month). Checkout refuses a price that differs. Copy the `price_…` ids into
   `STRIPE_PRICE_TEAM_BYOK` and `STRIPE_PRICE_AGENCY_PRO` — **these exact names**; any other
   name (for example `STRIPE_PRICE_MONTHLY`) is never read. A plan has one price: monthly and
   annual prices for one plan need a code change (a price list per plan, an interval on the
   form, and a decision on how an annual period counts runs) and are not supported today.
3. **Webhook (event destination)**: Workbench → Webhooks → *Create an event destination* →
   *Your account* → **Snapshot** payload, API version **2026-09-30.endive** (what
   `stripe@23.0.0` pins) → events: `checkout.session.completed`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `customer.subscription.paused`,
   `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed` → URL
   `https://<deployment>/api/stripe/webhook`. Copy the `whsec_…` into `STRIPE_WEBHOOK_SECRET`.
   Locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
   **Point it at the deployment that holds the sandbox keys.** Production has none, so a
   destination at `https://www.nover.space/api/stripe/webhook` receives 503 for every event and
   Stripe will retry, warn and eventually disable it. A Preview deployment sits behind Vercel
   Authentication: generate *Protection Bypass for Automation* and append
   `?x-vercel-protection-bypass=<secret>` to the destination URL, and use a stable branch alias.
   Set `CANONICAL_HOST` (Preview) to that alias so Checkout returns to the preview, not to
   production.
4. **Customer portal** (Settings → Billing → Customer portal): allow updating payment
   methods and viewing invoices; allow cancellation **at end of billing period**; allow
   switching between the two plan products (for upgrade/downgrade) only when both prices are
   on the allow-list — a switch to an unlisted price is stored as "not recognised" and grants
   nothing; turn on Tax ID only if
   D9 = B2B. Optionally save a configuration and put its `bpc_…` in
   `STRIPE_PORTAL_CONFIGURATION`.
5. **Subscriptions and emails** (Settings → Billing → Subscriptions and emails): Smart
   Retries on; "if all retries fail" per D6; customer emails for receipts, failed payments
   and upcoming renewals on (Stripe sends them, Novera does not).
6. **Stripe Tax** only after §4 items 1–4: then `BILLING_AUTOMATIC_TAX=1`.
7. **Branding and public details**: business name, support email, terms and privacy URLs
   (Phase 4 documents).
8. Test with **test clocks** (Billing → Test clocks). **Not reachable today:** Novera creates its
   own customer at Checkout and never attaches a clock, and a customer made on a clock in the
   dashboard is not in `billing_customers`, so its events are refused. Until a clock option is
   added, test a failed payment with card `4000 0000 0000 0341` in the portal and *Reset billing
   cycle* in the dashboard. The intended walk: create a customer on a clock, subscribe,
   advance a month (renewal → `invoice.paid`), switch to card `4000 0000 0000 0341` and
   advance (failure → `past_due` → grace → restricted), schedule cancellation in the portal
   and advance past the period end (`customer.subscription.deleted`).

### Required environment variables

| Variable | Value | Default |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` (sandbox) | unset → billing off |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | unset → billing off |
| `STRIPE_PRICE_TEAM_BYOK`, `STRIPE_PRICE_AGENCY_PRO` | `price_…` | unset → plan not purchasable |
| `STRIPE_PORTAL_CONFIGURATION` | `bpc_…` | Stripe's default portal |
| `BILLING_AUTOMATIC_TAX` | `1` to enable Stripe Tax on Checkout | off |
| `BILLING_TAX_ID_COLLECTION` | `1` to ask for a business tax ID | off |
| `BILLING_GRACE_DAYS` | 0–30 | 7 |
| `BILLING_ALLOW_LIVE` | **must stay unset** until P5 is signed off | unset → live keys refused |

Server-only: none of them has a `NEXT_PUBLIC_` prefix and none reaches a client bundle
(checked in the build output).

### Two changes outside this phase's files (done)

- **CSP `form-action`** in `src/proxy.ts` includes `https://checkout.stripe.com
  https://billing.stripe.com`.
- **Settings nav** has the Billing entry (owner/admin see the buttons; every member may
  see the page).

---

## 6. What Stripe sends vs what Novera sends

| | Stripe | Novera |
|---|---|---|
| Payment receipts | yes (email, if enabled in dashboard) | no |
| Invoices (PDF, hosted page) | yes, also in the portal | no |
| Failed-payment and card-expiry emails | yes (if enabled) | no |
| Upcoming renewal notices | yes (if enabled) | no |
| Cancellation confirmation | yes (if enabled) | no |
| Billing state in the app | — | Settings → Billing, from webhook-written rows |

Novera sends **no billing email** (production sends no email at all today; see CLAUDE.md).

---

## 7. Sandbox vs live activation checklist

**Sandbox (can be done now, by David, no approval of prices needed):**

1. Migrations 0060, 0065, 0066 and 0067 (applied with `npm run migrate`).
2. Configure §5 steps 1–5 in a Stripe sandbox, with prices of exactly **€99.00** and **€299.00**
   EUR, recurring monthly, licensed — checkout refuses any other amount; set the sandbox variables in `.env.local` and
   Vercel *Preview* only, then create a Preview deployment (a branch push) — Preview variables
   do nothing until one exists. Never put the Stripe keys in Production.
3. Use a throwaway workspace; its sandbox rows stay until it is erased.
4. Run a test checkout with card `4242 4242 4242 4242`; confirm the page shows the plan only
   after the webhook, never on return. Walk the test-clock scenarios.

**Live (P5 — blocked until every item is signed off):**

1. §3 decisions made (D1 VAT display, D5–D10 still open); §4 items signed off by accountant
   and lawyer.
2. Terms, privacy notice and sub-processor list (Phase 4) published with Stripe named.
3. A migration adding an approved status to `billing_plans` and the code change in
   `PLAN_CATALOG`/`decideCheckout` that lets an approved plan sell live (no draft plan ever
   can).
4. Live products and prices created; live webhook destination and portal configured
   (live mode has its own copies of both).
5. Live keys set in Vercel *Production* with `BILLING_ALLOW_LIVE=1` — the last step, by David.
6. ~~Wire billing into run starts~~ — done 2026-10-12 (0067). Before live: a funded grading
   budget for Agency Pro's managed runs.
7. ~~Align the public copy with D3~~ — done 2026-10-12. Publishing the prices themselves on the
   home page waits for billing to open.
8. Decide what erasure does with a live subscription beyond refusing (section 1): today a
   person cancels first.
