import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { billingConfig, keyMode } from "../src/lib/billing/config.ts";
import { PLAN_CATALOG, PLAN_KEYS, READ_ONLY_FEATURES, planForPrice } from "../src/lib/billing/plans.ts";
import { resolveEntitlement, type EntitlementInput, type SubscriptionRow } from "../src/lib/billing/entitlement.ts";
import { checkoutRequest, decideCheckout, isStripeHostedUrl } from "../src/lib/billing/checkout.ts";
import { handleStripeWebhook } from "../src/lib/billing/webhook.ts";
import { can, ROLES } from "../src/lib/auth/permissions.ts";
import { DAY, FakeStripe, MemoryStore, SECRET, T0, signedEvent, subscription } from "./billing-fakes.ts";

const ENV = {
  STRIPE_SECRET_KEY: "sk_test_51Novera",
  STRIPE_WEBHOOK_SECRET: SECRET,
  STRIPE_PRICE_TEAM_BYOK: "price_team",
  STRIPE_PRICE_AGENCY_PRO: "price_agency",
};
const config = billingConfig(ENV);
const WS_A = "10000000-0000-0000-0000-00000000000a";
const WS_B = "10000000-0000-0000-0000-00000000000b";

function setup() {
  const store = new MemoryStore();
  store.customers.set("cus_A", { workspaceId: WS_A, livemode: false });
  store.customers.set("cus_B", { workspaceId: WS_B, livemode: false });
  const stripe = new FakeStripe();
  const deliver = (e: { rawBody: string; signature: string | null }, opts: { gateway?: boolean; now?: Date } = {}) =>
    handleStripeWebhook({ ...e, config, store, gateway: opts.gateway === false ? null : stripe, now: opts.now ? () => opts.now! : undefined });
  return { store, stripe, deliver };
}

const iso = (unix: number) => new Date(unix * 1000).toISOString();

function rowsOf(store: MemoryStore, ws = WS_A): SubscriptionRow[] {
  return [...store.subscriptions.values()].filter((s) => s.workspaceId === ws).map((s) => ({
    stripeSubscriptionId: s.stripeSubscriptionId, status: s.status, planKey: s.planKey,
    currentPeriodStart: s.currentPeriodStart, currentPeriodEnd: s.currentPeriodEnd,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd, cancelAt: s.cancelAt, delinquentSince: s.delinquentSince,
    stripeCreatedAt: s.stripeCreatedAt,
  }));
}

function entitlementAt(store: MemoryStore, now: number, extra: Partial<EntitlementInput> = {}) {
  return resolveEntitlement({
    now: new Date(now * 1000),
    graceDays: config.graceDays,
    trialRunsUsed: 3,
    trialLimit: 3,
    byok: { connected: false, routable: false, provider: null },
    byokRequiresPlan: false,
    subscriptions: rowsOf(store),
    grants: [],
    runTimes: [],
    totalRuns: 3,
    ...extra,
  });
}

// ------------------------------------------------------------------ config

test("billing is off without both secrets, refuses live keys unless explicitly allowed, and keeps tax off by default", () => {
  assert.equal(billingConfig({}).active, false);
  assert.match(billingConfig({}).reason!, /not active yet/);
  assert.equal(billingConfig({ STRIPE_SECRET_KEY: "sk_test_x" }).active, false, "no webhook secret");
  assert.equal(billingConfig({ ...ENV, STRIPE_SECRET_KEY: "pk_test_x" }).active, false, "a publishable key is not a secret key");
  const live = billingConfig({ ...ENV, STRIPE_SECRET_KEY: "sk_live_x" });
  assert.equal(live.active, false);
  assert.equal(live.secretKey, null, "a refused key is not kept");
  assert.match(live.reason!, /live billing has not been approved/);
  assert.equal(billingConfig({ ...ENV, STRIPE_SECRET_KEY: "rk_live_x" }).active, false);
  assert.equal(billingConfig({ ...ENV, STRIPE_SECRET_KEY: "sk_live_x", BILLING_ALLOW_LIVE: "1" }).mode, "live");
  assert.equal(config.active, true);
  assert.equal(config.mode, "test");
  assert.equal(config.automaticTax, false);
  assert.equal(config.taxIdCollection, false);
  assert.equal(billingConfig({ ...ENV, BILLING_AUTOMATIC_TAX: "1", BILLING_TAX_ID_COLLECTION: "true" }).automaticTax, true);
  assert.equal(keyMode("sk_test_1"), "test");
  assert.equal(keyMode("whatever"), null);
  // A malformed price is not on the allow-list.
  assert.deepEqual(billingConfig({ ...ENV, STRIPE_PRICE_TEAM_BYOK: "prod_123" }).prices, { agency_pro: "price_agency" });
});

test("the code's plan catalog is the migration's, and every plan is a draft", () => {
  const sql = readFileSync("supabase/migrations/0060_billing.sql", "utf8");
  for (const key of PLAN_KEYS) {
    const m = new RegExp(`\\('${key}',\\s*'[^']*',\\s*(\\d+),\\s*'(\\w+)'`).exec(sql);
    assert.ok(m, `${key} is seeded`);
    assert.equal(Number(m![1]), PLAN_CATALOG[key].runsPerPeriod, `${key} allowance`);
    assert.equal(m![2], "draft");
    assert.equal(PLAN_CATALOG[key].status, "draft");
  }
  assert.match(sql, /status in \('draft', 'disabled'\)/, "no plan row can be sellable");
});

test("only the owner and admins manage billing", () => {
  for (const role of ROLES) assert.equal(can(role, "billing.manage"), role === "owner" || role === "admin", role);
});

test("0060 keeps everything 0056's erase_workspace did, and erases every billing table", () => {
  const body = (file: string) => {
    const sql = readFileSync(file, "utf8");
    const at = sql.lastIndexOf("create or replace function erase_workspace");
    return sql.slice(at, sql.indexOf("$$;", at));
  };
  const before = body("supabase/migrations/0056_suite_builder.sql");
  const after = body("supabase/migrations/0060_billing.sql");
  for (const line of before.split("\n").map((l) => l.trim()).filter((l) => /^(delete|update|insert|select|perform|values|returning|where)/.test(l))) {
    assert.ok(after.includes(line), `still in erase_workspace: ${line}`);
  }
  for (const table of ["billing_events", "billing_webhook_events", "billing_subscription_history", "billing_subscriptions", "billing_entitlement_grants", "billing_customers"]) {
    assert.match(after, new RegExp(`delete from ${table}\\s+where workspace_id = target`), table);
  }
  assert.ok(after.indexOf("delete from billing_subscriptions") < after.indexOf("delete from billing_customers"), "subscriptions before the customer they name");
  assert.ok(after.indexOf("delete from billing_customers") < after.indexOf("delete from workspaces"));
});

// ------------------------------------------------------------------ signature

test("a bad, missing or replayed signature writes nothing", async () => {
  const { store, deliver } = setup();
  const good = signedEvent("customer.subscription.updated", subscription({}));
  assert.equal((await deliver({ rawBody: good.rawBody, signature: null })).status, 400);
  const wrongSecret = signedEvent("customer.subscription.updated", subscription({}), { secret: "whsec_someone_else" });
  assert.equal((await deliver(wrongSecret)).status, 400);
  const tampered = { rawBody: good.rawBody.replace('"active"', '"canceled"'), signature: good.signature };
  const res = await deliver(tampered);
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "Signature verification failed.");
  // Signed six minutes ago: outside Stripe's default 300 s tolerance.
  const { default: Stripe } = await import("stripe");
  const old = Stripe.webhooks.generateTestHeaderString({ payload: good.rawBody, secret: SECRET, timestamp: Math.floor(Date.now() / 1000) - 360 });
  assert.equal((await deliver({ rawBody: good.rawBody, signature: old })).status, 400);
  assert.equal(store.events.size, 0);
  assert.equal(store.subscriptions.size, 0);
});

test("billing that is not configured answers 503 and reads nothing", async () => {
  const store = new MemoryStore();
  const res = await handleStripeWebhook({ ...signedEvent("invoice.paid", {}), config: billingConfig({}), store, gateway: null });
  assert.equal(res.status, 503);
  assert.equal(store.events.size, 0);
});

test("an event from the other Stripe mode is refused", async () => {
  const { store, deliver } = setup();
  const res = await deliver(signedEvent("customer.subscription.updated", subscription({}), { livemode: true }));
  assert.equal(res.status, 400);
  assert.equal(store.subscriptions.size, 0);
});

// ------------------------------------------------------------------ idempotency

test("a duplicate delivery of the same event does nothing the second time", async () => {
  const { store, stripe, deliver } = setup();
  stripe.current.set("sub_A1", subscription({}));
  const e = signedEvent("customer.subscription.created", subscription({}), { id: "evt_dup1" });
  const first = await deliver(e);
  assert.deepEqual(first, { status: 200, body: { received: true, outcome: "processed" } });
  const second = await deliver(e);
  assert.deepEqual(second, { status: 200, body: { received: true, duplicate: true } });
  assert.equal(store.history.length, 1);
  assert.equal(stripe.calls.filter((c) => c.startsWith("retrieve")).length, 1);
});

test("a failure is answered 500 so Stripe retries, and the retry claims the event again", async () => {
  const { store, stripe, deliver } = setup();
  stripe.current.set("sub_A1", subscription({}));
  stripe.failNextRetrieve = true;
  const e = signedEvent("customer.subscription.updated", subscription({}), { id: "evt_retry1" });
  assert.equal((await deliver(e)).status, 500);
  assert.equal(store.events.get("evt_retry1")!.status, "failed");
  assert.equal(store.subscriptions.size, 0);
  assert.equal((await deliver(e)).status, 200);
  assert.equal(store.events.get("evt_retry1")!.attempts, 2);
  assert.equal(store.subscriptions.get("sub_A1")!.status, "active");
});

test("an event still being handled elsewhere is answered 409, not acknowledged", async () => {
  const { store, deliver } = setup();
  store.events.set("evt_busy", { status: "processing", attempts: 1, detail: null, workspaceId: null });
  assert.equal((await deliver(signedEvent("invoice.paid", {}, { id: "evt_busy" }))).status, 409);
});

// ------------------------------------------------------------------ ordering

test("out of order: a late, older event re-reads Stripe and cannot undo a cancellation", async () => {
  const { store, stripe, deliver } = setup();
  stripe.current.set("sub_A1", subscription({ status: "canceled" }));
  await deliver(signedEvent("customer.subscription.deleted", subscription({ status: "canceled" }), { created: T0 + 200 }));
  // The `created` event of the same subscription arrives last, carrying "active".
  await deliver(signedEvent("customer.subscription.created", subscription({ status: "active" }), { created: T0 + 1 }));
  assert.equal(store.subscriptions.get("sub_A1")!.status, "canceled");
  assert.ok(stripe.calls.every((c) => c === "retrieve sub_A1"), "each event read the current object");
});

test("out of order without a Stripe client: an older snapshot never replaces a newer one, and canceled is terminal", async () => {
  const { store, deliver } = setup();
  await deliver(signedEvent("customer.subscription.updated", subscription({ status: "active" }), { created: T0 + 100 }), { gateway: false });
  await deliver(signedEvent("customer.subscription.created", subscription({ status: "incomplete" }), { created: T0 + 10 }), { gateway: false });
  assert.equal(store.subscriptions.get("sub_A1")!.status, "active", "the older incomplete snapshot was not written");
  await deliver(signedEvent("customer.subscription.deleted", subscription({ status: "canceled" }), { created: T0 + 200 }), { gateway: false });
  // Even a *later* snapshot cannot bring a canceled subscription back.
  const res = await deliver(signedEvent("customer.subscription.updated", subscription({ status: "active" }), { created: T0 + 300 }), { gateway: false });
  assert.equal(res.status, 200);
  assert.equal(store.subscriptions.get("sub_A1")!.status, "canceled");
  assert.equal(store.history.length, 2);
});

// ------------------------------------------------------------------ checkout

test("an abandoned checkout grants nothing, and neither does a completed one whose payment has not cleared", async () => {
  const { store, stripe, deliver } = setup();
  // Started and abandoned: no event ever arrives. The workspace is where it was.
  assert.equal(entitlementAt(store, T0).source, "trial", "still the (used-up) trial");
  assert.equal(entitlementAt(store, T0).canRun, false);
  assert.equal(entitlementAt(store, T0).subscription, null);

  stripe.current.set("sub_A1", subscription({ status: "incomplete" }));
  await deliver(signedEvent("checkout.session.completed", {
    id: "cs_test_1", object: "checkout.session", mode: "subscription", customer: "cus_A",
    subscription: "sub_A1", client_reference_id: WS_A, metadata: { workspace_id: WS_A },
    status: "complete", payment_status: "unpaid",
  }));
  assert.equal(store.subscriptions.get("sub_A1")!.status, "incomplete");
  const e = entitlementAt(store, T0 + 60);
  assert.equal(e.subscription!.standing, "incomplete");
  assert.equal(e.canRun, false);
  assert.notEqual(e.source, "subscription");
  assert.ok(store.trail.some((l) => l.action === "checkout.completed"));

  // Payment clears: Stripe's subscription becomes active, and only that grants the plan.
  stripe.current.set("sub_A1", subscription({ status: "active" }));
  await deliver(signedEvent("invoice.paid", { id: "in_1", object: "invoice", parent: { type: "subscription_details", subscription_details: { subscription: "sub_A1" } } }));
  const paid = entitlementAt(store, T0 + 120);
  assert.equal(paid.source, "subscription");
  assert.equal(paid.planKey, "team_byok");
  assert.equal(paid.runsAllowed, PLAN_CATALOG.team_byok.runsPerPeriod);
  assert.equal(paid.canRun, true);
});

test("a checkout or subscription naming another workspace is refused and logged, never written", async () => {
  const { store, stripe, deliver } = setup();
  stripe.current.set("sub_A1", subscription({ status: "active" }));
  const res = await deliver(signedEvent("checkout.session.completed", {
    id: "cs_test_x", object: "checkout.session", mode: "subscription", customer: "cus_A",
    subscription: "sub_A1", client_reference_id: WS_B, metadata: {},
  }));
  assert.deepEqual(res.body, { received: true, outcome: "refused" });
  assert.equal(store.subscriptions.size, 0);
  assert.ok(store.trail.some((l) => l.action === "webhook.refused" && l.workspaceId === WS_A));

  stripe.current.set("sub_A2", subscription({ id: "sub_A2", workspace: WS_B }));
  assert.equal((await deliver(signedEvent("customer.subscription.created", subscription({ id: "sub_A2", workspace: WS_B })))).body.outcome, "refused");
  assert.equal(store.subscriptions.size, 0);

  stripe.current.set("sub_Z", subscription({ id: "sub_Z", customer: "cus_unknown" }));
  assert.equal((await deliver(signedEvent("customer.subscription.created", subscription({ id: "sub_Z", customer: "cus_unknown" })))).body.outcome, "refused");
  assert.equal(store.subscriptions.size, 0);
});

// ------------------------------------------------------------------ payment failure

test("a failed payment keeps the plan through the grace period, then restricts — and deletes nothing", async () => {
  const { store, stripe, deliver } = setup();
  stripe.current.set("sub_A1", subscription({ status: "active" }));
  await deliver(signedEvent("customer.subscription.created", subscription({})));

  stripe.current.set("sub_A1", subscription({ status: "past_due" }));
  const failedAt = T0 + 30 * DAY;
  await deliver(signedEvent("invoice.payment_failed", { id: "in_2", object: "invoice", parent: { subscription_details: { subscription: "sub_A1" } } }, { created: failedAt }));
  const since = store.subscriptions.get("sub_A1")!.delinquentSince;
  assert.equal(since, iso(failedAt));

  const inGrace = entitlementAt(store, failedAt + DAY);
  assert.equal(inGrace.subscription!.standing, "grace");
  assert.equal(inGrace.source, "subscription");
  assert.equal(inGrace.canRun, true);

  // A second failure during the same delinquency does not restart the clock.
  await deliver(signedEvent("invoice.payment_failed", { id: "in_2", object: "invoice", parent: { subscription_details: { subscription: "sub_A1" } } }, { created: failedAt + 3 * DAY }));
  assert.equal(store.subscriptions.get("sub_A1")!.delinquentSince, since);

  const after = entitlementAt(store, failedAt + (config.graceDays + 1) * DAY);
  assert.equal(after.subscription!.standing, "restricted");
  assert.equal(after.canRun, false);
  assert.ok(!after.features.includes("runs.start"));
  for (const f of READ_ONLY_FEATURES) assert.ok(after.features.includes(f), `evidence stays: ${f}`);

  // Stripe gives up and marks it unpaid: still restricted, still nothing deleted.
  stripe.current.set("sub_A1", subscription({ status: "unpaid" }));
  await deliver(signedEvent("customer.subscription.updated", subscription({ status: "unpaid" })));
  assert.equal(entitlementAt(store, failedAt + 20 * DAY).subscription!.standing, "restricted");

  // Paid: back to active, the delinquency cleared.
  stripe.current.set("sub_A1", subscription({ status: "active" }));
  await deliver(signedEvent("invoice.paid", { id: "in_2", object: "invoice", parent: { subscription_details: { subscription: "sub_A1" } } }));
  assert.equal(store.subscriptions.get("sub_A1")!.delinquentSince, null);
  assert.equal(entitlementAt(store, failedAt + 21 * DAY).subscription!.standing, "active");
  assert.ok(store.trail.some((l) => l.action === "invoice.payment_failed"));
  assert.ok(store.trail.some((l) => l.action === "invoice.paid"));
});

// ------------------------------------------------------------------ cancellation

test("cancellation at period end keeps the plan until the end, then the deletion ends it; reactivation before then restores it", async () => {
  const { store, stripe, deliver } = setup();
  const end = T0 + 30 * DAY;
  stripe.current.set("sub_A1", subscription({ cancelAtPeriodEnd: true, periodEnd: end }));
  await deliver(signedEvent("customer.subscription.updated", subscription({})));
  const cancelling = entitlementAt(store, T0 + 10 * DAY);
  assert.equal(cancelling.subscription!.standing, "cancelling");
  assert.equal(cancelling.subscription!.endsAt, iso(end));
  assert.equal(cancelling.source, "subscription");

  // Changed their mind before the end.
  stripe.current.set("sub_A1", subscription({ cancelAtPeriodEnd: false, periodEnd: end }));
  await deliver(signedEvent("customer.subscription.updated", subscription({})));
  assert.equal(entitlementAt(store, T0 + 11 * DAY).subscription!.standing, "active");

  // Cancelled again, and this time the period runs out.
  stripe.current.set("sub_A1", subscription({ cancelAtPeriodEnd: true, periodEnd: end }));
  await deliver(signedEvent("customer.subscription.updated", subscription({})));
  assert.equal(entitlementAt(store, end + 60).subscription!.standing, "ended", "past the end, even before Stripe's deletion arrives");
  stripe.current.set("sub_A1", subscription({ status: "canceled", cancelAtPeriodEnd: true, periodEnd: end }));
  await deliver(signedEvent("customer.subscription.deleted", subscription({})));
  assert.equal(store.subscriptions.get("sub_A1")!.status, "canceled");
  assert.equal(entitlementAt(store, end + DAY).canRun, false);

  // A new subscription after the old one ended: the newest decides.
  stripe.current.set("sub_A2", subscription({ id: "sub_A2", created: end + 2 * DAY, periodStart: end + 2 * DAY }));
  await deliver(signedEvent("customer.subscription.created", subscription({ id: "sub_A2" })));
  const again = entitlementAt(store, end + 3 * DAY);
  assert.equal(again.subscription!.stripeSubscriptionId, "sub_A2");
  assert.equal(again.source, "subscription");
});

// ------------------------------------------------------------------ plan changes

test("an upgrade and a downgrade change the allowance from Stripe's price, through the allow-list", async () => {
  const { store, stripe, deliver } = setup();
  stripe.current.set("sub_A1", subscription({ price: "price_team" }));
  await deliver(signedEvent("customer.subscription.created", subscription({})));
  assert.equal(entitlementAt(store, T0 + DAY).runsAllowed, PLAN_CATALOG.team_byok.runsPerPeriod);

  stripe.current.set("sub_A1", subscription({ price: "price_agency" }));
  await deliver(signedEvent("customer.subscription.updated", subscription({})));
  assert.equal(entitlementAt(store, T0 + 2 * DAY).planKey, "agency_pro");
  assert.equal(entitlementAt(store, T0 + 2 * DAY).runsAllowed, PLAN_CATALOG.agency_pro.runsPerPeriod);
  const line = store.trail.findLast((l) => l.action === "subscription.synced")!;
  assert.equal(line.detail!.previous_plan_key, "team_byok");
  assert.equal(line.detail!.plan_key, "agency_pro");

  stripe.current.set("sub_A1", subscription({ price: "price_team" }));
  await deliver(signedEvent("customer.subscription.updated", subscription({})));
  assert.equal(entitlementAt(store, T0 + 3 * DAY).planKey, "team_byok");
  // Runs already in this period count against the smaller allowance; none of them is removed.
  const runs = Array.from({ length: 31 }, (_, i) => iso(T0 + i * 3600));
  const over = entitlementAt(store, T0 + 3 * DAY, { runTimes: runs, totalRuns: 34 });
  assert.equal(over.canRun, false);
  assert.equal(over.runsUsed, 31);
  assert.match(over.blockedReason!, /runs have been used/);
});

test("a subscription on a price that is not on the allow-list is stored and grants nothing", async () => {
  const { store, stripe, deliver } = setup();
  stripe.current.set("sub_A1", subscription({ price: "price_someone_made_in_the_dashboard" }));
  await deliver(signedEvent("customer.subscription.created", subscription({})));
  assert.equal(store.subscriptions.get("sub_A1")!.planKey, null);
  assert.ok(store.trail.some((l) => l.action === "subscription.unrecognised_price"));
  const e = entitlementAt(store, T0 + DAY);
  assert.equal(e.subscription!.standing, "unrecognised");
  assert.notEqual(e.source, "subscription");
});

// ------------------------------------------------------------------ price allow-list

test("checkout accepts one plan key from the allow-list and nothing else", () => {
  const ok = decideCheckout({ config, requestedPlan: "team_byok", subscriptions: [] });
  assert.deepEqual(ok, { ok: true, planKey: "team_byok", priceId: "price_team" });
  for (const bad of ["price_team", "price_agency", "enterprise", "", null, undefined, 42, "__proto__", "toString"]) {
    const d = decideCheckout({ config, requestedPlan: bad, subscriptions: [] });
    assert.equal(d.ok, false, String(bad));
  }
  // A plan whose price is not configured cannot be bought.
  assert.equal(decideCheckout({ config: billingConfig({ ...ENV, STRIPE_PRICE_AGENCY_PRO: "" }), requestedPlan: "agency_pro", subscriptions: [] }).ok, false);
  // Live mode refuses every draft plan.
  const live = billingConfig({ ...ENV, STRIPE_SECRET_KEY: "sk_live_x", BILLING_ALLOW_LIVE: "1" });
  const refused = decideCheckout({ config: live, requestedPlan: "team_byok", subscriptions: [] });
  assert.equal(refused.ok, false);
  assert.match((refused as { error: string }).error, /not been approved/);
  // Billing off: nothing to buy.
  assert.equal(decideCheckout({ config: billingConfig({}), requestedPlan: "team_byok", subscriptions: [] }).ok, false);
  // Prices map back only through the allow-list.
  assert.equal(planForPrice("price_agency", config.prices), "agency_pro");
  assert.equal(planForPrice("price_other", config.prices), null);
});

test("a workspace with an open subscription is sent to the portal, not into a second checkout", () => {
  const open: SubscriptionRow = {
    stripeSubscriptionId: "sub_A1", status: "past_due", planKey: "team_byok", currentPeriodStart: null,
    currentPeriodEnd: null, cancelAtPeriodEnd: false, cancelAt: null, delinquentSince: null, stripeCreatedAt: iso(T0),
  };
  assert.equal(decideCheckout({ config, requestedPlan: "agency_pro", subscriptions: [open] }).ok, false);
  assert.equal(decideCheckout({ config, requestedPlan: "agency_pro", subscriptions: [{ ...open, status: "canceled" }] }).ok, true);
  assert.equal(decideCheckout({ config, requestedPlan: "agency_pro", subscriptions: [{ ...open, status: "incomplete_expired" }] }).ok, true);
});

test("the checkout's return addresses are this deployment's billing page and carry no state", () => {
  const req = checkoutRequest({ config, decision: { planKey: "team_byok", priceId: "price_team" }, customer: "cus_A", workspaceId: WS_A, origin: "https://www.nover.space" });
  assert.equal(req.successUrl, "https://www.nover.space/settings/billing?checkout=returned");
  assert.equal(req.cancelUrl, "https://www.nover.space/settings/billing?checkout=cancelled");
  assert.equal(req.automaticTax, false);
  assert.equal(req.taxIdCollection, false);
  assert.ok(isStripeHostedUrl("https://checkout.stripe.com/c/pay/cs_test_1", "checkout.stripe.com"));
  for (const bad of ["http://checkout.stripe.com/x", "https://checkout.stripe.com.evil.example/x", "https://evil.example/?https://checkout.stripe.com", null]) {
    assert.equal(isStripeHostedUrl(bad, "checkout.stripe.com"), false, String(bad));
  }
});

// ------------------------------------------------------------------ portal return

test("returning from the portal changes nothing: the page only picks a sentence, and portal events are ignored", async () => {
  const { store, stripe, deliver } = setup();
  stripe.current.set("sub_A1", subscription({}));
  await deliver(signedEvent("customer.subscription.created", subscription({})));
  const before = structuredClone([...store.subscriptions.values()]);
  const res = await deliver(signedEvent("billing_portal.session.created", { id: "bps_1", object: "billing_portal.session", customer: "cus_A" }));
  assert.deepEqual(res.body, { received: true, outcome: "ignored" });
  assert.deepEqual([...store.subscriptions.values()], before);

  const page = readFileSync("src/app/(app)/settings/billing/page.tsx", "utf8");
  // The query string is compared to fixed words and never handed to anything that reads or writes state.
  assert.match(page, /loadBillingView\(admin, ctx\.workspace\.id\)/);
  const uses = page.match(/params\.\w+/g) ?? [];
  assert.ok(uses.every((u) => u === "params.checkout" || u === "params.portal"), uses.join(","));
  assert.doesNotMatch(page, /\{params\.(checkout|portal)\}/, "a parameter is never rendered");
});

// ------------------------------------------------------------------ entitlement merge

test("sources do not add up: grant before subscription before own key before trial, each counted from stored runs", () => {
  const now = T0 + 5 * DAY;
  const base: EntitlementInput = {
    now: new Date(now * 1000), graceDays: 7, trialRunsUsed: 1, trialLimit: 3,
    byok: { connected: false, routable: false, provider: null }, byokRequiresPlan: false,
    subscriptions: [], grants: [], runTimes: [], totalRuns: 1,
  };
  const trial = resolveEntitlement(base);
  assert.equal(trial.source, "trial");
  assert.deepEqual(trial.trial, { used: 1, limit: 3 });

  const exhausted = resolveEntitlement({ ...base, trialRunsUsed: 3 });
  assert.equal(exhausted.canRun, false);
  assert.match(exhausted.blockedReason!, /trial covers 3 runs/);

  const byok = resolveEntitlement({ ...base, trialRunsUsed: 3, byok: { connected: true, routable: true, provider: "groq" } });
  assert.equal(byok.source, "byok");
  assert.equal(byok.runsAllowed, null);
  assert.equal(byok.trial, null, "trial numbers only when the trial applies");

  const unroutable = resolveEntitlement({ ...base, byok: { connected: true, routable: false, provider: "groq" } });
  assert.equal(unroutable.canRun, false);
  assert.match(unroutable.blockedReason!, /no model recorded/);

  const requiresPlan = resolveEntitlement({ ...base, byok: { connected: true, routable: true, provider: "groq" }, byokRequiresPlan: true });
  assert.equal(requiresPlan.source, "none");
  assert.deepEqual(requiresPlan.features, READ_ONLY_FEATURES, "with nothing in force, evidence stays readable and exportable");

  const grant = {
    id: "g1", kind: "pilot" as const, planKey: "agency_pro", runsAllowed: 2,
    startsAt: iso(T0), endsAt: iso(T0 + 30 * DAY), revokedAt: null,
  };
  const granted = resolveEntitlement({ ...base, grants: [grant], runTimes: [iso(T0 + DAY)] });
  assert.equal(granted.source, "manual_grant");
  assert.equal(granted.runsUsed, 1);
  assert.equal(granted.grantId, "g1");

  // The grant's two runs used: the trial (still unused) takes over; nothing is summed.
  const grantUsed = resolveEntitlement({ ...base, grants: [grant], runTimes: [iso(T0 + DAY), iso(T0 + 2 * DAY)] });
  assert.equal(grantUsed.source, "trial");
  // A revoked or expired grant is not in force.
  assert.equal(resolveEntitlement({ ...base, grants: [{ ...grant, revokedAt: iso(T0 + DAY) }] }).source, "trial");
  assert.equal(resolveEntitlement({ ...base, grants: [{ ...grant, endsAt: iso(T0 + DAY) }] }).source, "trial");
  // A run before the subscription's period does not count against it.
  const sub: SubscriptionRow = {
    stripeSubscriptionId: "sub_A1", status: "active", planKey: "team_byok",
    currentPeriodStart: iso(T0 + 3 * DAY), currentPeriodEnd: iso(T0 + 33 * DAY),
    cancelAtPeriodEnd: false, cancelAt: null, delinquentSince: null, stripeCreatedAt: iso(T0),
  };
  const subscribed = resolveEntitlement({ ...base, subscriptions: [sub], runTimes: [iso(T0 + DAY), iso(T0 + 4 * DAY)] });
  assert.equal(subscribed.source, "subscription");
  assert.equal(subscribed.runsUsed, 1);
  // Unknown Stripe status: stored, grants nothing.
  assert.equal(resolveEntitlement({ ...base, subscriptions: [{ ...sub, status: "something_new" }] }).subscription!.standing, "unrecognised");
});
