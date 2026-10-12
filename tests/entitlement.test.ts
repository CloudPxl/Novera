import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { READ_ONLY_FEATURES } from "../src/lib/billing/plans.ts";
import { resolveEntitlement, type EntitlementInput, type SubscriptionRow } from "../src/lib/billing/entitlement.ts";
import { DAY, T0 } from "./billing-fakes.ts";

/**
 * Who may start a run, and what it is stamped with: decision D3 (the trial is the whole free
 * tier, after it a plan or a grant, own key or not), plan-funded grading, and fair use.
 * The Stripe side of billing is tests/billing.test.ts.
 */

const iso = (unix: number) => new Date(unix * 1000).toISOString();
// ------------------------------------------------------------------ D3: billing gates runs (2026-10-12)

const SUB_PRO: SubscriptionRow = {
  stripeSubscriptionId: "sub_Pro1", status: "active", planKey: "agency_pro",
  currentPeriodStart: iso(T0), currentPeriodEnd: iso(T0 + 30 * DAY),
  cancelAtPeriodEnd: false, cancelAt: null, delinquentSince: null, stripeCreatedAt: iso(T0),
};
const D3: EntitlementInput = {
  now: new Date((T0 + DAY) * 1000), graceDays: 7, trialRunsUsed: 0, trialLimit: 3,
  byok: { connected: true, routable: true, provider: "groq" }, byokRequiresPlan: true,
  subscriptions: [], grants: [], runTimes: [], totalRuns: 0,
};

test("D3: own key runs free only inside the trial; after three runs it needs a plan", () => {
  const inTrial = resolveEntitlement({ ...D3, trialRunsUsed: 2 });
  assert.deepEqual([inTrial.source, inTrial.canRun, inTrial.judgeSource, inTrial.runsOn], ["trial", true, "workspace_key", "own_key"],
    "a trial run on the workspace's own key is graded on that key");
  assert.deepEqual(inTrial.funding, { subscriptionId: null, grantId: null });

  const spent = resolveEntitlement({ ...D3, trialRunsUsed: 3 });
  assert.equal(spent.canRun, false);
  assert.equal(spent.blocker, "trial_used");
  assert.equal(spent.judgeSource, null, "nothing funds a run, so a run has no source to be stamped with");
  assert.match(spent.blockedReason!, /runs on your own model key need a plan/);
  assert.doesNotMatch(spent.blockedReason!, /nothing to pay/i);

  const noKey = resolveEntitlement({ ...D3, trialRunsUsed: 3, byok: { connected: false, routable: false, provider: null } });
  assert.deepEqual([noKey.canRun, noKey.blocker], [false, "trial_used"]);
  assert.match(noKey.blockedReason!, /Team BYOK.*Agency Pro/);

  // The old rule is still a stated input, not a silent default.
  assert.equal(resolveEntitlement({ ...D3, trialRunsUsed: 3, byokRequiresPlan: false }).source, "byok");
});

test("D3: an active Team BYOK or Agency Pro subscription lets a keyed workspace run, unmetered, naming the subscription", () => {
  for (const planKey of ["team_byok", "agency_pro"] as const) {
    const e = resolveEntitlement({ ...D3, trialRunsUsed: 3, subscriptions: [{ ...SUB_PRO, planKey }], runTimes: Array.from({ length: 40 }, (_, i) => iso(T0 + 60 + i)) });
    assert.deepEqual([e.source, e.planKey, e.canRun, e.runsAllowed, e.judgeSource], ["subscription", planKey, true, null, "workspace_key"], planKey);
    assert.deepEqual(e.funding, { subscriptionId: "sub_Pro1", grantId: null });
  }
  // A subscription that stopped counting says so, rather than "the trial is used".
  const lapsed = resolveEntitlement({ ...D3, trialRunsUsed: 3, subscriptions: [{ ...SUB_PRO, status: "canceled" }] });
  assert.deepEqual([lapsed.source, lapsed.canRun, lapsed.blocker], ["none", false, "subscription_lapsed"]);
  assert.deepEqual(lapsed.features, READ_ONLY_FEATURES, "with nothing in force, evidence stays readable and exportable");
  // A grant funds runs too, and names itself.
  const grant = { id: "g1", kind: "pilot" as const, planKey: null, runsAllowed: 5, startsAt: iso(T0), endsAt: null, revokedAt: null };
  const granted = resolveEntitlement({ ...D3, trialRunsUsed: 3, grants: [grant] });
  assert.deepEqual([granted.source, granted.canRun, granted.funding.grantId], ["manual_grant", true, "g1"]);
});

test("Agency Pro without a key grades on Novera's keys as plan_managed, up to its 100 runs", () => {
  const noKey = { connected: false, routable: false, provider: null };
  const pro = resolveEntitlement({ ...D3, byok: noKey, trialRunsUsed: 3, subscriptions: [SUB_PRO], managedRunTimes: Array.from({ length: 99 }, (_, i) => iso(T0 + 60 + i)) });
  assert.deepEqual([pro.canRun, pro.judgeSource, pro.runsUsed, pro.runsAllowed], [true, "plan_managed", 99, 100]);
  assert.equal(pro.funding.subscriptionId, "sub_Pro1");
  const full = resolveEntitlement({ ...D3, byok: noKey, trialRunsUsed: 3, subscriptions: [SUB_PRO], managedRunTimes: Array.from({ length: 100 }, (_, i) => iso(T0 + 60 + i)) });
  assert.deepEqual([full.canRun, full.blocker], [false, "allowance_used"]);
  // Inside the trial a workspace without a key is still the trial: trial_free, not the plan.
  const trial = resolveEntitlement({ ...D3, byok: noKey, trialRunsUsed: 1 });
  assert.equal(trial.judgeSource, "trial_free");
});

test("fair use refuses a funded run past 3 in flight or 1,000 in 30 days, with a sentence and a kind", async () => {
  const { MAX_RUNS_IN_FLIGHT, FAIR_USE_RUNS, FAIR_USE_WINDOW_DAYS, FAIR_USE_REFUSAL, CONCURRENCY_REFUSAL } = await import("../src/lib/billing/limits.ts");
  const paid = { ...D3, trialRunsUsed: 3, subscriptions: [{ ...SUB_PRO, planKey: "team_byok" }] };
  assert.equal(resolveEntitlement({ ...paid, runsInFlight: MAX_RUNS_IN_FLIGHT - 1 }).canRun, true);
  const busy = resolveEntitlement({ ...paid, runsInFlight: MAX_RUNS_IN_FLIGHT });
  assert.deepEqual([busy.canRun, busy.blocker, busy.blockedReason], [false, "concurrency", CONCURRENCY_REFUSAL]);
  assert.equal(busy.source, "subscription", "fair use does not hide which plan is in force");
  const runaway = resolveEntitlement({ ...paid, runsInWindow: FAIR_USE_RUNS });
  assert.deepEqual([runaway.canRun, runaway.blocker], [false, "fair_use"]);
  assert.match(FAIR_USE_REFUSAL, /^Fair-use threshold reached/);
  assert.match(FAIR_USE_REFUSAL, /Contact support/);
  // The trial is held to it as well.
  assert.equal(resolveEntitlement({ ...D3, runsInFlight: 3 }).blocker, "concurrency");

  // The database holds the same numbers under its lock (0067).
  const sql = readFileSync("supabase/migrations/0067_run_funding_and_fair_use.sql", "utf8");
  assert.match(sql, new RegExp(`in_flight >= ${MAX_RUNS_IN_FLIGHT} then`));
  assert.match(sql, new RegExp(`recent >= ${FAIR_USE_RUNS} then`));
  assert.match(sql, new RegExp(`interval '${FAIR_USE_WINDOW_DAYS} days'`));
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('novera:run-start'\), hashtext\(new\.workspace_id::text\)\)/);
  assert.match(sql, /judge_source in \('trial_free', 'workspace_key', 'plan_managed'\)/);
  assert.match(sql, /managed_allowance_exhausted/);
  assert.match(sql, /or new\.funded_by_subscription is distinct from old\.funded_by_subscription/, "funding is frozen with the run");
  // Plan-managed runs share the trial's grading slots on Novera's keys.
  assert.match(sql, /r\.judge_source in \('trial_free', 'plan_managed'\)/);
});

test("every refusal a run start can meet leads somewhere: plan, key, runs in progress, support", async () => {
  const { remedyFor, needsBillingAction, BILLING_PATH } = await import("../src/lib/billing/remedy.ts");
  assert.equal(BILLING_PATH, "/billing");
  for (const b of ["trial_used", "needs_plan", "allowance_used", "grant_used", "subscription_lapsed"] as const) {
    assert.equal(remedyFor(b)!.href, "/billing", b);
    assert.equal(needsBillingAction(b), true, b);
  }
  assert.equal(remedyFor("needs_key")!.href, "/settings");
  assert.equal(remedyFor("key_unroutable")!.href, "/settings");
  assert.equal(remedyFor("concurrency")!.href, "/runs");
  assert.equal(remedyFor("fair_use")!.href, "/support");
  assert.equal(remedyFor(null), null);
  assert.equal(needsBillingAction("concurrency"), false);
  // startRun stamps what the decision returned and maps the database's refusals.
  const start = readFileSync("src/lib/workflow/start-run.ts", "utf8");
  assert.match(start, /funded_by_subscription: entitlement\.funding\.subscriptionId/);
  assert.match(start, /funded_by_grant: entitlement\.funding\.grantId/);
  assert.match(start, /judge_source: entitlement\.judgeSource/);
  for (const code of ["trial_exhausted", "concurrent_runs_limit", "fair_use_limit", "managed_allowance_exhausted", "grant_exhausted", "run_not_funded"]) {
    assert.match(start, new RegExp(code), code);
  }
  // workspaceEntitlement applies D3 on every deployment.
  assert.match(readFileSync("src/lib/auth/entitlement.ts", "utf8"), /byokRequiresPlan: true/);
});

test("a report says who funded the grading, and a plan-funded run is never called the trial", async () => {
  const { gradingFundedBy } = await import("../src/lib/report/build.ts");
  assert.equal(gradingFundedBy("trial_free"), "Novera trial allowance");
  assert.equal(gradingFundedBy("workspace_key"), "customer-supplied model key");
  assert.equal(gradingFundedBy("plan_managed"), "Novera, under the workspace's plan");
});

test("the funding line names the plan and what is left", async () => {
  const { fundingLine } = await import("../src/lib/billing/entitlement.ts");
  assert.equal(fundingLine(resolveEntitlement({ ...D3, trialRunsUsed: 1 }), true), "Trial · own key · 2 of 3 runs left");
  assert.equal(fundingLine(resolveEntitlement({ ...D3, trialRunsUsed: 3, subscriptions: [{ ...SUB_PRO, planKey: "team_byok" }] }), true), "Team BYOK · own key");
  const noKey = { connected: false, routable: false, provider: null };
  assert.equal(fundingLine(resolveEntitlement({ ...D3, byok: noKey, trialRunsUsed: 3, subscriptions: [SUB_PRO], managedRunTimes: [iso(T0 + 60)] }), false), "Agency Pro · 99 of 100 managed runs left");
});
