# Billing: what is built, what is proposed, what David decides

Phase 3 of the launch program (`docs/LAUNCH-READINESS.md`, P1–P5). Written 2026-10-09.

**State: sandbox only, prices approved.** Billing code exists and is off. It turns on only
when Stripe *test* keys are configured, refuses live keys, and does not yet decide whether a
run may start. The plan prices were approved by David on 2026-10-12 (§2) and are shown on
Settings → Billing; nothing can be bought live until the §7 live checklist is done. Nothing
here is a sales term or legal advice.

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
first in-force source with room wins, in the order **manual grant → subscription → own key
→ trial**. A plan counts two kinds of run differently: with a model key connected, runs on
that key are **unlimited** (counted, never capped); without one, only the plan's **managed**
allowance applies — runs graded on Novera's keys (`judge_source` not `workspace_key`), 0 on
Team BYOK, 100 a period on Agency Pro; if none has room, the highest in-force one says why. Allowances are windows over
the same `runs` rows, counted, never estimated. Grace: a `past_due` subscription keeps its
plan for `BILLING_GRACE_DAYS` (default 7) from the first failure of that delinquency, then
is *restricted*; `unpaid` is restricted at once. Restricted or nothing in force: no new
runs, every run/case/report stays readable and exportable.

### Deliberately not done yet

- **Run start is not gated by billing.** `src/lib/auth/entitlement.ts` (trial, then BYOK
  unmetered) still decides. Wiring `resolveEntitlement` in is one call in
  `workspaceEntitlement`, but it waits on decision D2 below, because a plan whose runs are
  graded on *Novera's* keys needs a new `judge_source` (the report states who funded the
  grading), and 0055's trial-cap trigger refuses every `trial_free` run past three.
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
  an operator with the service role (reason and `granted_by` required by the database).
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

**What the catalog does not yet do (before live, §7):**

- **Agency Pro's 100 managed runs cannot be spent yet.** Run start does not consult billing, and
  past the 3 trial runs the database refuses any run graded on Novera's keys (0055). Selling it
  live needs: a `judge_source` for plan-funded grading (the report states who paid), the trial
  cap trigger to let a workspace with an in-force plan through, and `resolveEntitlement` wired into
  `startRun`. Plus a funded grading budget for 100 runs × the number of Agency Pro workspaces.
- **Team BYOK sells nothing a workspace cannot do free today** while D3 stays "yes": a workspace
  with its own key runs unmetered without a plan, and the home page and docs say "there is nothing
  to pay us". See D3.

## 3. Decisions David must make

| # | Decision | Default in code until then |
|---|---|---|
| D1 | Prices, currency, interval — **decided 2026-10-12:** €99 / €299 a month, EUR, monthly only. **Open:** VAT-inclusive or exclusive display (accountant) | the page shows the list price and says VAT is confirmed before billing opens |
| D2 | Does any paid plan grade on Novera's keys? — **decided 2026-10-12: yes, Agency Pro, 100 a period.** Needs a `judge_source`, the 0055 trigger change and run gating before live (§2) | not spendable yet: runs past the trial on Novera's keys are refused |
| D3 | When billing goes live, does a BYOK workspace **without** a plan keep unmetered runs (today's rule)? **Still open, and now load-bearing:** if yes, Team BYOK grants nothing extra; if no, the run gate must ship with live billing and the public "nothing to pay us" copy must change first | yes (`byokRequiresPlan: false`) |
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

1. Migrations 0060, 0065 and 0066 (applied with `npm run migrate`).
2. Configure §5 steps 1–5 in a Stripe sandbox, with prices of exactly **€99.00** and **€299.00**
   EUR, recurring monthly, licensed — checkout refuses any other amount; set the sandbox variables in `.env.local` and
   Vercel *Preview* only, then create a Preview deployment (a branch push) — Preview variables
   do nothing until one exists. Never put the Stripe keys in Production.
3. Use a throwaway workspace; its sandbox rows stay until it is erased.
4. Run a test checkout with card `4242 4242 4242 4242`; confirm the page shows the plan only
   after the webhook, never on return. Walk the test-clock scenarios.

**Live (P5 — blocked until every item is signed off):**

1. §3 decisions made (D1 VAT display, D3, D5–D10 still open); §4 items signed off by accountant
   and lawyer.
2. Terms, privacy notice and sub-processor list (Phase 4) published with Stripe named.
3. A migration adding an approved status to `billing_plans` and the code change in
   `PLAN_CATALOG`/`decideCheckout` that lets an approved plan sell live (no draft plan ever
   can).
4. Live products and prices created; live webhook destination and portal configured
   (live mode has its own copies of both).
5. Live keys set in Vercel *Production* with `BILLING_ALLOW_LIVE=1` — the last step, by David.
6. Wire billing into run starts: plan-funded `judge_source`, the 0055 trigger change, and
   `resolveEntitlement` in `startRun`, so Agency Pro's managed runs can be spent (and, if D3 is
   "no", so a key without a plan stops after the trial).
7. Align the public copy with the catalog ("nothing to pay us" on the home page and in
   `/docs/the-trial-and-your-own-key`).
8. Decide what erasure does with a live subscription beyond refusing (section 1): today a
   person cancels first.
