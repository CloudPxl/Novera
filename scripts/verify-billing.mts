/**
 * Proves billing end to end against a real database, on a throwaway workspace: Stripe's signed
 * webhook through the real Supabase store (0060), the entitlement it produces, the attribution a
 * run carries (0067), and fair use under concurrency.
 *
 * tests/billing.test.ts proves the same webhook rules against an in-memory store. This proves the
 * tables, triggers and the store's SQL agree with it. Stripe itself is never called: the gateway is
 * the offline fake from the tests, and the keys below are fake sandbox values set in this process
 * only. It writes billing rows, so it refuses any database that is not a local one.
 *
 * Run: npm run verify:billing
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
  console.error("verify:billing writes Stripe sandbox rows and runs only against a local database.");
  process.exit(1);
}

// A sandbox configuration for this process only; nothing here is a real key.
process.env.STRIPE_SECRET_KEY = "sk_test_51NoveraVerifyBilling";
const { SECRET, FakeStripe, signedEvent, subscription } = await import("../tests/billing-fakes.ts");
process.env.STRIPE_WEBHOOK_SECRET = SECRET;
process.env.STRIPE_PRICE_TEAM_BYOK = "price_team";
process.env.STRIPE_PRICE_AGENCY_PRO = "price_agency";
delete process.env.VERCEL_ENV;

const { billingConfig } = await import("../src/lib/billing/config.ts");
const { handleStripeWebhook } = await import("../src/lib/billing/webhook.ts");
const { supabaseBillingStore } = await import("../src/lib/billing/supabase-store.ts");
const { workspaceEntitlement } = await import("../src/lib/auth/entitlement.ts");
const { remedyFor } = await import("../src/lib/billing/remedy.ts");
const { storeSecret } = await import("../src/lib/store/secrets.ts");

const db = createClient(url, key, { auth: { persistSession: false } });
const config = billingConfig();
const store = supabaseBillingStore(db);
const stripe = new FakeStripe();

let failures = 0;
function report(ok: boolean, label: string, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}
const deliver = (e: { rawBody: string; signature: string | null }) =>
  handleStripeWebhook({ ...e, config, store, gateway: stripe });

const tag = Date.now().toString(36);
const { data: created, error: userErr } = await db.auth.admin.createUser({
  email: `billing+${tag}@novera.invalid`, password: crypto.randomUUID(), email_confirm: true,
});
if (userErr || !created?.user) {
  console.error(`Could not create a verification user: ${userErr?.message}`);
  process.exit(1);
}
const userId = created.user.id;
let workspaceId: string | null = null;

console.log("\nBilling: webhook ledger, entitlement, attribution, fair use");
report(config.active && config.mode === "test", "the sandbox configuration is active for this process", config.reason ?? "");

try {
  const { data: ws } = await db.from("workspaces").insert({ name: "__novera_billing__", owner_id: userId }).select("id").single();
  workspaceId = ws!.id as string;
  const { data: agent } = await db.from("agents").insert({ workspace_id: workspaceId, name: "billing", kind: "http", config: {} }).select("id").single();
  const { data: policy } = await db.from("policies").insert({ workspace_id: workspaceId, agent_id: agent!.id, version: 1, body: "p" }).select("id").single();
  const { data: suite } = await db.from("suites").select("id").is("workspace_id", null).limit(1).single();
  const runRow = (extra: Record<string, unknown>) => ({
    workspace_id: workspaceId, agent_id: agent!.id, policy_id: policy!.id, suite_id: suite!.id, ...extra,
  });

  // A run aborted before it recorded any scenario uses no trial run (0074); one that recorded a
  // scenario does.
  const { data: emptyAbort } = await db.from("runs").insert(runRow({ status: "aborted", judge_source: "trial_free" })).select("id").single();
  const freeAbort = await workspaceEntitlement({ client: db, workspaceId });
  report(freeAbort.runsUsed === 0 && freeAbort.canRun, "a trial run aborted before any scenario does not count against the trial", `${freeAbort.runsUsed} used`);
  const { error: caseErr } = await db.from("run_cases").insert({
    workspace_id: workspaceId, run_id: emptyAbort!.id, case_id: "T01", category: "c", obligation: "privacy", severity: "high",
    input: "hi", expected: "x", assertions: [], status: "error", error: "verify:billing — the agent could not be reached",
  });
  const recorded = await workspaceEntitlement({ client: db, workspaceId });
  report(!caseErr && recorded.runsUsed === 1, "once it holds a recorded scenario, the aborted run counts", caseErr?.message.slice(0, 70) ?? `${recorded.runsUsed} used`);

  // The trial, used up.
  for (let i = 0; i < 2; i++) {
    const { error } = await db.from("runs").insert(runRow({ status: "completed", judge_source: "trial_free" }));
    if (error) report(false, "filling the trial", error.message.slice(0, 70));
  }
  const { error: overTrial } = await db.from("runs").insert(runRow({ status: "aborted", judge_source: "trial_free" }));
  report(/trial_exhausted/.test(overTrial?.message ?? ""), "the database refuses a fourth trial run, the aborted one with a scenario counted", overTrial?.message.slice(0, 70) ?? "it was accepted");
  const used = await workspaceEntitlement({ client: db, workspaceId });
  report(!used.canRun && used.blocker === "trial_used", "after three trial runs the workspace cannot run", used.blocker ?? "");
  report(remedyFor(used.blocker!)?.href === "/billing", "and the refusal points to /billing", remedyFor(used.blocker!)?.href ?? "none");

  // ---------------------------------------------------------------- the webhook ledger
  const customer = `cus_V${tag}`;
  const subId = `sub_V${tag}`;
  await db.from("billing_customers").insert({ workspace_id: workspaceId, stripe_customer_id: customer, livemode: false, created_by: userId });
  const periodStart = Math.floor(Date.now() / 1000) - 86_400;
  const sub = (o: Record<string, unknown> = {}) =>
    subscription({ id: subId, customer, price: "price_agency", periodStart, created: periodStart, workspace: workspaceId!, ...o });

  const forged = signedEvent("customer.subscription.updated", sub(), { secret: "whsec_someone_else" });
  const forgedRes = await deliver(forged);
  const forgedId = JSON.parse(forged.rawBody).id as string;
  const { count: forgedRows } = await db.from("billing_webhook_events").select("*", { count: "exact", head: true }).eq("stripe_event_id", forgedId);
  report(forgedRes.status === 400 && forgedRows === 0, "a delivery with a wrong signature is refused and writes nothing", `${forgedRes.status}, ${forgedRows} rows`);

  stripe.current.set(subId, sub({ status: "active" }));
  const checkout = signedEvent("checkout.session.completed", {
    id: `cs_test_${tag}`, object: "checkout.session", mode: "subscription", customer, subscription: subId,
    client_reference_id: workspaceId, metadata: { workspace_id: workspaceId }, status: "complete", payment_status: "paid",
  });
  const first = await deliver(checkout);
  report(first.status === 200 && first.body.outcome === "processed", "checkout.session.completed is processed", JSON.stringify(first.body));
  const again = await deliver(checkout);
  report(again.status === 200 && again.body.duplicate === true, "the same event delivered again does nothing", JSON.stringify(again.body));
  const checkoutId = JSON.parse(checkout.rawBody).id as string;
  const { data: ledger } = await db.from("billing_webhook_events").select("status, attempts").eq("stripe_event_id", checkoutId);
  report(ledger?.length === 1 && ledger[0].status === "processed", "the ledger holds that event once, processed", JSON.stringify(ledger));
  const { data: subRow } = await db.from("billing_subscriptions").select("status, plan_key, livemode").eq("stripe_subscription_id", subId).single();
  report(subRow?.status === "active" && subRow?.plan_key === "agency_pro" && subRow?.livemode === false,
    "the subscription row is Agency Pro, active, sandbox", JSON.stringify(subRow));

  // ---------------------------------------------------------------- attribution
  const pro = await workspaceEntitlement({ client: db, workspaceId });
  report(pro.canRun && pro.judgeSource === "plan_managed", "Agency Pro without a model key runs on Novera's keys as plan_managed", `${pro.judgeSource}`);
  report(pro.funding.subscriptionId === subId, "and names the subscription that funds it", String(pro.funding.subscriptionId));

  // Twelve starts at once: the per-workspace lock lets exactly three in.
  const race = await Promise.all(Array.from({ length: 12 }, () =>
    db.from("runs").insert(runRow({ status: "queued", judge_source: "plan_managed", funded_by_subscription: subId })).select("id").single()));
  const accepted = race.filter((r) => !r.error).length;
  const limited = race.filter((r) => /concurrent_runs_limit/.test(r.error?.message ?? "")).length;
  report(accepted === 3 && limited === 9, "twelve concurrent starts: three accepted, nine refused concurrent_runs_limit", `${accepted} accepted, ${limited} refused`);
  const busy = await workspaceEntitlement({ client: db, workspaceId });
  report(!busy.canRun && busy.blocker === "concurrency", "the application reports the ceiling before trying", busy.blocker ?? "");
  const { data: racedRows } = await db.from("runs").select("judge_source, funded_by_subscription").eq("workspace_id", workspaceId).eq("status", "queued");
  report((racedRows ?? []).every((r) => r.judge_source === "plan_managed" && r.funded_by_subscription === subId),
    "each accepted run is stamped plan_managed and funded_by_subscription");
  const { error: frozen } = await db.from("runs").update({ funded_by_subscription: null }).eq("workspace_id", workspaceId).eq("status", "queued");
  report(/cannot be changed/.test(frozen?.message ?? ""), "a run's funding cannot be rewritten afterwards", frozen?.message.slice(0, 60) ?? "it was changed");
  const counted = await workspaceEntitlement({ client: db, workspaceId });
  await db.from("runs").update({ status: "aborted", finished_at: new Date().toISOString() }).eq("workspace_id", workspaceId).eq("status", "queued");
  // Stopped before recording any scenario, the three raced runs give their units back (0074).
  const freed = await workspaceEntitlement({ client: db, workspaceId });
  report(counted.billing.runsUsed === accepted && freed.billing.runsUsed === 0 && freed.canRun,
    "queued managed runs count; stopped before any scenario, they no longer use the managed allowance",
    `${counted.billing.runsUsed} while queued, ${freed.billing.runsUsed} after stopping`);

  // The managed allowance: 100 a period, the 101st refused. Completed runs count; empty aborted ones do not.
  const managed = Array.from({ length: 100 }, () => runRow({ status: "completed", judge_source: "plan_managed", funded_by_subscription: subId }));
  const { error: fillErr } = await db.from("runs").insert(managed);
  report(!fillErr, "managed runs up to the allowance of 100 are accepted, the three stopped empty not counted", fillErr?.message.slice(0, 70) ?? "");
  const { error: overManaged } = await db.from("runs").insert(runRow({ status: "aborted", judge_source: "plan_managed", funded_by_subscription: subId }));
  report(/managed_allowance_exhausted: 100 of 100/.test(overManaged?.message ?? ""), "the 101st managed run in the period is refused", overManaged?.message.slice(0, 70) ?? "it was accepted");

  // With the customer's own key, the same plan grades on that key.
  await storeSecret({ client: db, workspaceId, scope: "judge_key", plaintext: "sk-not-a-real-key-only-used-to-prove-resolution", provider: "groq" });
  const keyed = await workspaceEntitlement({ client: db, workspaceId });
  report(keyed.canRun && keyed.judgeSource === "workspace_key" && keyed.funding.subscriptionId === subId,
    "with a model key the plan's runs are workspace_key, still funded by the subscription", `${keyed.judgeSource}`);

  // ---------------------------------------------------------------- lifecycle events
  stripe.current.set(subId, sub({ status: "active", cancelAtPeriodEnd: true }));
  const upd = await deliver(signedEvent("customer.subscription.updated", sub({ cancelAtPeriodEnd: true })));
  const { data: afterUpd } = await db.from("billing_subscriptions").select("cancel_at_period_end, status").eq("stripe_subscription_id", subId).single();
  report(upd.body.outcome === "processed" && afterUpd?.cancel_at_period_end === true && afterUpd?.status === "active",
    "customer.subscription.updated records a cancellation at period end, plan still active", JSON.stringify(afterUpd));

  stripe.current.set(subId, sub({ status: "past_due", cancelAtPeriodEnd: true }));
  const failed = await deliver(signedEvent("invoice.payment_failed", { id: `in_${tag}`, object: "invoice", parent: { subscription_details: { subscription: subId } } }));
  const { data: afterFail } = await db.from("billing_subscriptions").select("status, delinquent_since").eq("stripe_subscription_id", subId).single();
  report(failed.body.outcome === "processed" && afterFail?.status === "past_due" && Boolean(afterFail?.delinquent_since),
    "invoice.payment_failed marks the subscription past due and starts the grace clock", JSON.stringify(afterFail));

  stripe.current.set(subId, sub({ status: "canceled" }));
  const del = await deliver(signedEvent("customer.subscription.deleted", sub({ status: "canceled" })));
  const { data: afterDel } = await db.from("billing_subscriptions").select("status").eq("stripe_subscription_id", subId).single();
  report(del.body.outcome === "processed" && afterDel?.status === "canceled", "customer.subscription.deleted ends the plan", JSON.stringify(afterDel));
  const { error: unfunded } = await db.from("runs").insert(runRow({ status: "aborted", judge_source: "workspace_key", funded_by_subscription: subId }));
  report(/run_not_funded/.test(unfunded?.message ?? ""), "a cancelled subscription funds no further run", unfunded?.message.slice(0, 70) ?? "it was accepted");
  const lapsed = await workspaceEntitlement({ client: db, workspaceId });
  report(!lapsed.canRun && remedyFor(lapsed.blocker)?.href === "/billing", "and the application sends the workspace back to /billing", lapsed.blocker ?? "");


  // ---------------------------------------------------------------- a metered grant
  // A grant's units count like the trial: an empty aborted run is free (0074). The window opens
  // now, so only runs from here on count against it.
  const { data: metered } = await db.from("billing_entitlement_grants").insert({
    workspace_id: workspaceId, kind: "pilot", runs_allowed: 1, reason: "verify:billing metered", granted_by: userId,
  }).select("id").single();
  const { error: emptyGrantRun } = await db.from("runs").insert(runRow({ status: "aborted", judge_source: "workspace_key", funded_by_grant: metered!.id }));
  const { error: firstGrantRun } = await db.from("runs").insert(runRow({ status: "completed", judge_source: "workspace_key", funded_by_grant: metered!.id }));
  report(!emptyGrantRun && !firstGrantRun, "a one-run grant accepts an empty aborted run and then its one counted run",
    (emptyGrantRun ?? firstGrantRun)?.message.slice(0, 70) ?? "");
  const { error: overGrant } = await db.from("runs").insert(runRow({ status: "aborted", judge_source: "workspace_key", funded_by_grant: metered!.id }));
  report(/grant_exhausted/.test(overGrant?.message ?? ""), "and refuses a second counted run grant_exhausted", overGrant?.message.slice(0, 70) ?? "it was accepted");
  await db.from("billing_entitlement_grants").update({ revoked_at: new Date().toISOString(), revoked_by: userId, revoke_reason: "verify:billing metered done" }).eq("id", metered!.id);

  // ---------------------------------------------------------------- fair use, 1,000 in 30 days
  // An unmetered grant funds the rest, so the ceiling met is fair use and not funding. The window
  // is filled with runs aborted before any scenario: free for every allowance, counted by fair use.
  const { data: grant } = await db.from("billing_entitlement_grants").insert({
    workspace_id: workspaceId, kind: "internal", runs_allowed: null, reason: "verify:billing", granted_by: userId,
  }).select("id").single();
  const { count: soFar } = await db.from("runs").select("*", { count: "exact", head: true }).eq("workspace_id", workspaceId);
  let remaining = 1000 - (soFar ?? 0);
  while (remaining > 0) {
    const n = Math.min(250, remaining);
    const { error } = await db.from("runs").insert(Array.from({ length: n }, () => runRow({ status: "aborted", judge_source: "workspace_key", funded_by_grant: grant!.id })));
    if (error) { report(false, "filling the 30-day window", error.message.slice(0, 70)); break; }
    remaining -= n;
  }
  const atCeiling = await workspaceEntitlement({ client: db, workspaceId });
  report(!atCeiling.canRun && atCeiling.blocker === "fair_use", "at 1,000 runs in 30 days the application refuses", atCeiling.blocker ?? "");
  const { error: overFair } = await db.from("runs").insert(runRow({ status: "aborted", judge_source: "workspace_key", funded_by_grant: grant!.id }));
  report(/fair_use_limit/.test(overFair?.message ?? ""), "the 1,001st run is refused fair_use_limit by the database", overFair?.message.slice(0, 70) ?? "it was accepted");

  const { count: history } = await db.from("billing_subscription_history").select("*", { count: "exact", head: true }).eq("stripe_subscription_id", subId);
  report((history ?? 0) >= 3, "every change is kept in the subscription history", `${history} rows`);
  const { count: runsKept } = await db.from("runs").select("*", { count: "exact", head: true }).eq("workspace_id", workspaceId);
  report((runsKept ?? 0) >= 1000, "no subscription change deleted a run", `${runsKept} runs`);
} catch (e) {
  report(false, "verification threw", (e as Error).message);
} finally {
  if (workspaceId) {
    const { error } = await db.rpc("erase_workspace", { target: workspaceId });
    const { count } = await db.from("billing_subscriptions").select("*", { count: "exact", head: true }).eq("workspace_id", workspaceId);
    report(!error && count === 0, "the workspace and its billing rows erase", error?.message.slice(0, 70) ?? `${count} subscription rows left`);
  }
  await db.auth.admin.deleteUser(userId).catch(() => {});
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll billing checks passed.");
process.exit(failures ? 1 : 0);
