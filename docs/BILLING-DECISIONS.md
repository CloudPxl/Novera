# Billing: what is built, what is proposed, what David decides

Phase 3 of the launch program (`docs/LAUNCH-READINESS.md`, P1–P5). Written 2026-10-09.

**State: sandbox only.** Billing code exists and is off. It turns on only when Stripe *test*
keys are configured, refuses live keys, offers no price anywhere, and does not yet decide
whether a run may start. Nothing here is a published price, a sales term or legal advice.

---

## 1. What is implemented

### The shape

| Piece | Where | What it does |
|---|---|---|
| Config | `src/lib/billing/config.ts` | Billing is *not active* unless `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are both set. `sk_live_`/`rk_live_` is refused unless `BILLING_ALLOW_LIVE=1`. A publishable key is refused. Tax flags default off. |
| Plan catalog | `src/lib/billing/plans.ts` + `billing_plans` (0060) | Two placeholder plan keys, run allowances, features. No price, no currency. Every plan is `draft`; the table's check constraint allows only `draft`/`disabled`. A test holds code and migration together. |
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
→ trial**; if none has room, the highest in-force one says why. Allowances are windows over
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
- **Erasing a workspace with a running subscription** does not cancel it at Stripe. The
  erase action (`src/lib/workflow/identity.ts`) should call `subscriptions.cancel` first
  when billing is active; not changed here because that file is shared.
- **No UI for manual grants.** The table, its rules and RLS exist; grants are inserted by
  an operator with the service role (reason and `granted_by` required by the database).
- `workspaces.plan` (`trial`/`paid`, 0001) is unused and left alone.
- No billing email from Novera — see section 6.

---

## 2. Proposed plan catalog (placeholders — nothing decided)

| Plan key | Working name | Runs / period (proposal) | Grading funded by | Price |
|---|---|---|---|---|
| — | Trial | 3 per account, across owned workspaces (today) | Novera's free-tier keys | free |
| `team_byok` | Team (BYOK) | 30 | the customer's own key | **undecided** (research anchor: €79–149 / month) |
| `agency_pro` | Agency Pro | 150 | **D2** | **undecided** (research anchor: €299–499 / month) |
| — | Pilot / support / internal | per grant | per grant | manual grant, no charge |

Names, allowances and prices are placeholders. Changing an allowance means editing
`PLAN_CATALOG` and a new migration (the test fails if they disagree).

---

## 3. Decisions David must make

| # | Decision | Default in code until then |
|---|---|---|
| D1 | Prices, currency (EUR only?), monthly vs annual, VAT-inclusive or exclusive display | none shown anywhere |
| D2 | Does any paid plan grade on Novera's keys? If yes, a funded vendor key and a new `judge_source` are needed first | no: paid plans are BYOK |
| D3 | When billing goes live, does a BYOK workspace **without** a plan keep unmetered runs (today's rule)? | yes (`byokRequiresPlan: false`) |
| D4 | Run allowances per plan; whether unused runs roll over (code: no) | 30 / 150, no rollover |
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
   EUR. Placeholder amounts in the sandbox only. Copy the `price_…` ids into
   `STRIPE_PRICE_TEAM_BYOK` and `STRIPE_PRICE_AGENCY_PRO`.
3. **Webhook (event destination)**: Workbench → Webhooks → *Create an event destination* →
   *Your account* → **Snapshot** payload, API version **2026-09-30.endive** (what
   `stripe@23.0.0` pins) → events: `checkout.session.completed`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `customer.subscription.paused`,
   `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed` → URL
   `https://<deployment>/api/stripe/webhook`. Copy the `whsec_…` into `STRIPE_WEBHOOK_SECRET`.
   Locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
4. **Customer portal** (Settings → Billing → Customer portal): allow updating payment
   methods and viewing invoices; allow cancellation **at end of billing period**; allow
   switching between the two plan products (for upgrade/downgrade); turn on Tax ID only if
   D9 = B2B. Optionally save a configuration and put its `bpc_…` in
   `STRIPE_PORTAL_CONFIGURATION`.
5. **Subscriptions and emails** (Settings → Billing → Subscriptions and emails): Smart
   Retries on; "if all retries fail" per D6; customer emails for receipts, failed payments
   and upcoming renewals on (Stripe sends them, Novera does not).
6. **Stripe Tax** only after §4 items 1–4: then `BILLING_AUTOMATIC_TAX=1`.
7. **Branding and public details**: business name, support email, terms and privacy URLs
   (Phase 4 documents).
8. Test with **test clocks** (Billing → Test clocks): create a customer on a clock, subscribe,
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

### Two changes outside this phase's files

- **CSP `form-action`** in `src/proxy.ts` must add `https://checkout.stripe.com
  https://billing.stripe.com`. With JavaScript the server action navigates to Stripe and
  is unaffected; without it, the form's redirect to Stripe is a form-action target and
  browsers block it.
- **Settings nav**: add the Billing entry (owner/admin see the buttons; every member may
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

1. Apply migration 0060 (`npm run migrate`).
2. Configure §5 steps 1–5 and 8 in a Stripe sandbox; set the sandbox variables in
   `.env.local` and Vercel *Preview* only.
3. Add the nav entry and the CSP change.
4. Run a test checkout with card `4242 4242 4242 4242`; confirm the page shows the plan only
   after the webhook, never on return. Walk the test-clock scenarios.

**Live (P5 — blocked until every item is signed off):**

1. §3 decisions D1–D10 made; §4 items signed off by accountant and lawyer.
2. Terms, privacy notice and sub-processor list (Phase 4) published with Stripe named.
3. A migration adding an approved status to `billing_plans` and the code change in
   `PLAN_CATALOG`/`decideCheckout` that lets an approved plan sell live (no draft plan ever
   can).
4. Live products and prices created; live webhook destination and portal configured
   (live mode has its own copies of both).
5. Live keys set in Vercel *Production* with `BILLING_ALLOW_LIVE=1` — the last step, by David.
6. Decide whether billing gates run starts (D2/D3) and wire `resolveEntitlement` in.
7. Erasure cancels a running subscription first (section 1, "not done yet").
