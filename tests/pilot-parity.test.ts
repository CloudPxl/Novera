import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { FEATURES } from "../src/lib/billing/plans.ts";
import {
  fundingDetail, fundingLine, grantName, ifKeyRemoved, keyRemovedNotice, PILOT_CODE_HINT, resolveEntitlement,
  type EntitlementInput, type GrantRow,
} from "../src/lib/billing/entitlement.ts";
import { remedyFor } from "../src/lib/billing/remedy.ts";
import { fundingBadge } from "../src/components/shell/funding-badge.ts";
import { DAY, T0 } from "./billing-fakes.ts";

/**
 * The pilot journey, held to the code: an agency past its three trial runs, given a pilot grant
 * (50 runs, 30 days, one workspace), can do everything a paying workspace can — and every
 * surface names the pilot as a pilot, says when it ends, and never sends anyone to an email
 * address that cannot receive mail (nover.space has no inbound MX).
 */

const iso = (unix: number) => new Date(unix * 1000).toISOString();
const NOW = T0 + 3 * DAY;
const PILOT: GrantRow = { id: "g-pilot", kind: "pilot", planKey: null, runsAllowed: 50, startsAt: iso(T0), endsAt: iso(T0 + 30 * DAY), revokedAt: null };
const NO_KEY = { connected: false, routable: false, provider: null };
const BASE: EntitlementInput = {
  now: new Date(NOW * 1000), graceDays: 7, trialRunsUsed: 3, trialLimit: 3,
  byok: NO_KEY, byokRequiresPlan: true, subscriptions: [], grants: [PILOT], runTimes: [], totalRuns: 3,
};
const runs = (n: number) => Array.from({ length: n }, (_, i) => iso(T0 + 60 + i));

test("a pilot past the trial runs on Novera's keys as plan_managed, names its grant, and keeps every feature", () => {
  const e = resolveEntitlement({ ...BASE, runTimes: runs(3) });
  assert.deepEqual([e.source, e.canRun, e.judgeSource, e.runsOn], ["manual_grant", true, "plan_managed", "novera"]);
  assert.deepEqual(e.funding, { subscriptionId: null, grantId: "g-pilot" });
  assert.deepEqual(e.grant, { kind: "pilot", endsAt: PILOT.endsAt, shared: false });
  // Nothing in the product is gated on a feature other than runs.start, and a grant carries all of them.
  assert.deepEqual([...e.features].sort(), [...FEATURES].sort());
  assert.equal(e.trial, null, "the trial is not what decides here");
});

test("a pilot is counted against its own runs, never against Agency Pro's 100 managed runs", () => {
  // 120 runs graded on Novera's keys in the window: past any plan's managed allowance, inside a 150-run grant.
  const big = resolveEntitlement({ ...BASE, grants: [{ ...PILOT, runsAllowed: 150 }], runTimes: runs(120), managedRunTimes: runs(120) });
  assert.deepEqual([big.canRun, big.runsUsed, big.runsAllowed], [true, 120, 150]);

  const last = resolveEntitlement({ ...BASE, runTimes: runs(49) });
  assert.deepEqual([last.canRun, last.runsUsed], [true, 49]);
  const spent = resolveEntitlement({ ...BASE, runTimes: runs(50) });
  assert.deepEqual([spent.canRun, spent.blocker], [false, "grant_used"]);
  assert.equal(spent.blockedReason, "The pilot grant's 50 runs have been used.");
  assert.equal(remedyFor(spent.blocker)!.href, "/billing");
  // Out of runs is not out of evidence: everything except starting a run stays.
  assert.ok(!spent.features.includes("runs.start") && spent.features.includes("reports.export"));
});

test("a pilot with the workspace's own key grades on that key and still counts against the pilot", () => {
  const e = resolveEntitlement({ ...BASE, byok: { connected: true, routable: true, provider: "groq" }, runTimes: runs(5) });
  assert.deepEqual([e.source, e.judgeSource, e.runsUsed, e.funding.grantId], ["manual_grant", "workspace_key", 5, "g-pilot"]);
});

test("fair use still applies to a pilot, with its own sentence and remedy", () => {
  const busy = resolveEntitlement({ ...BASE, runsInFlight: 3 });
  assert.deepEqual([busy.canRun, busy.blocker, busy.source], [false, "concurrency", "manual_grant"]);
  assert.equal(remedyFor("fair_use")!.href, "/support");
});

test("a pilot that ran out of time says so, rather than only that the trial is used", () => {
  const after = resolveEntitlement({ ...BASE, now: new Date((T0 + 31 * DAY) * 1000) });
  assert.deepEqual([after.canRun, after.blocker, after.source], [false, "trial_used", "trial"]);
  assert.match(after.blockedReason!, /^The pilot grant ended on \d{4}-\d{2}-\d{2}\. The trial covers 3 runs/);
  assert.equal(remedyFor(after.blocker)!.href, "/billing");
  // A revoked grant is not described as having ended.
  const revoked = resolveEntitlement({ ...BASE, now: new Date((T0 + 31 * DAY) * 1000), grants: [{ ...PILOT, revokedAt: iso(T0 + DAY) }] });
  assert.doesNotMatch(revoked.blockedReason!, /ended/);
  // A workspace that never had a grant reads as before, and is told where a pilot code goes.
  const never = resolveEntitlement({ ...BASE, grants: [] });
  assert.match(never.blockedReason!, /^The trial covers 3 runs/);
  assert.ok(never.blockedReason!.endsWith(PILOT_CODE_HINT));
  assert.ok(resolveEntitlement({ ...BASE, grants: [], byok: { connected: true, routable: true, provider: "groq" } }).blockedReason!.endsWith(PILOT_CODE_HINT));
  // The hint is true only while Billing has the pilot code form; the remedy of the block leads there.
  assert.match(readFileSync("src/app/(app)/settings/billing/page.tsx", "utf8"), /PilotCodeForm/);
  assert.equal(remedyFor(never.blocker)!.href, "/billing");
});

test("every surface names a pilot as a pilot, with what is left and when it ends", () => {
  const e = resolveEntitlement({ ...BASE, runTimes: runs(3) });
  const until = PILOT.endsAt!.slice(0, 10);
  assert.equal(grantName("pilot"), "Pilot");
  assert.equal(grantName("support"), "Grant");
  assert.equal(fundingLine(e, false), `Pilot · 47 of 50 runs left · until ${until}`);
  assert.equal(fundingDetail(e), `Pilot · 47 of 50 runs left · until ${until}`);
  const badge = fundingBadge({ canRun: true, blocker: null, billing: e } as Parameters<typeof fundingBadge>[0]);
  assert.deepEqual(badge, { text: "Pilot · 47 left", tone: "pass" });
  // The trial keeps its own words; nothing calls a pilot a plan.
  assert.equal(fundingDetail(resolveEntitlement({ ...BASE, grants: [], trialRunsUsed: 1 })), null);
  const dashboard = readFileSync("src/app/(app)/dashboard/page.tsx", "utf8");
  assert.doesNotMatch(dashboard, /"Graded on Novera's keys, under your plan"/);
  // Since 0076 the reader's perspective is passed, so an owner-wide pilot reads "your workspaces".
  assert.match(dashboard, /fundingDetail\(entitlement\.billing, role === "owner"\)/);
});

test("Settings → Grading tells a pilot workspace the truth about its key", () => {
  const e = resolveEntitlement({ ...BASE, byok: { connected: true, routable: true, provider: "groq" }, runTimes: runs(3) });
  assert.equal(ifKeyRemoved(e, { used: 3, limit: 3 }), "Runs would then grade on Novera's keys, still counted against the pilot's runs (47 of 50 left).");
  assert.match(ifKeyRemoved(resolveEntitlement({ ...BASE, grants: [], trialRunsUsed: 1 }), { used: 1, limit: 3 }), /trial allowance, which has 2 of 3 left/);
  assert.equal(keyRemovedNotice({ canRun: true, blockedReason: null, fundingLine: "Pilot · 47 of 50 runs left" }), "Removed. Runs now grade on Novera's keys: Pilot · 47 of 50 runs left.");
  // The old notices were false under D3: a key never lifted the trial cap, nor restores runs after it.
  const actions = readFileSync("src/lib/workflow/actions.ts", "utf8");
  assert.doesNotMatch(actions, /trial cap no longer applies|until a key is connected/);
  const settings = readFileSync("src/app/(app)/settings/workspace-settings.tsx", "utf8");
  assert.match(settings, /fundedOnNovera \? "Novera's keys" : "trial allowance"/);
});

test("a sealed report funded by a grant says so, and the run passes what funded it", async () => {
  const { gradingFundedBy, GRANT_FUNDED } = await import("../src/lib/report/build.ts");
  assert.equal(gradingFundedBy("plan_managed", "grant"), GRANT_FUNDED);
  assert.equal(gradingFundedBy("plan_managed", "subscription"), "Novera, under the workspace's plan");
  assert.equal(gradingFundedBy("plan_managed"), "Novera, under the workspace's plan", "absent reads as before");
  assert.equal(gradingFundedBy("workspace_key", "grant"), "customer-supplied model key", "a grant on the workspace's own key is graded on that key");
  const execute = readFileSync("src/lib/workflow/execute-run.ts", "utf8");
  assert.match(execute, /funded_by_grant, funded_by_subscription/);
  // A grant held by the workspace, or its owner's pool held by another of their workspaces (0076).
  assert.match(execute, /fundedBy: await runFunding\(run\.funded_by_grant as string \| null, run\.funded_by_subscription as string \| null\)/);
  // Model work (Ask Novera, Builder readings) on Novera's keys is not called the trial either.
  const { fundingLabel } = await import("../src/lib/providers/model-work.ts");
  assert.equal(fundingLabel("trial_free"), "Novera's keys");
  assert.equal(fundingLabel("workspace_key"), "your own key");
});

test("a single-scenario check is funded like a run: refused only when nothing funds runs, never by fair use", () => {
  const check = readFileSync("src/lib/workflow/scenario-check.ts", "utf8");
  assert.match(check, /!entitlement\.canRun && entitlement\.blocker !== "concurrency" && entitlement\.blocker !== "fair_use"/);
  assert.match(check, /judge_source: entitlement\.judgeSource/);
  // The table takes a pilot's plan_managed stamp (0072).
  assert.match(readFileSync("supabase/migrations/0072_scenario_checks.sql", "utf8"), /'trial_free', 'workspace_key', 'plan_managed'/);
});

// ------------------------------------------------------------------ email that bounces

function files(dir: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path, pattern));
    else if (pattern.test(name)) out.push(path);
  }
  return out;
}

test("no page, refusal, email or document offers an @nover.space address or a mailto link", () => {
  // nover.space has no inbound MX: a person who writes to any address there gets a bounce.
  // In-app routes instead: /support for help, /apply for a pilot. The legal drafts keep their
  // [CONTACT EMAIL] placeholders until the founder sets up inbound mail.
  const offenders: string[] = [];
  for (const path of [...files("src", /\.(ts|tsx)$/), ...files("data/docs", /\.md$/), ...files("data/legal", /\.ts$/)]) {
    const text = readFileSync(path, "utf8");
    if (/mailto:/.test(text) || /[A-Za-z0-9._%+-]+@nover\.space/.test(text)) offenders.push(path);
  }
  // The sender's own configuration is not an address shown to anyone.
  assert.deepEqual(offenders.filter((p) => !p.startsWith(join("src", "lib", "mail", "diagnostics.ts"))), []);
  const form = readFileSync("src/app/support/form.tsx", "utf8") + readFileSync("src/lib/support/actions.ts", "utf8");
  assert.doesNotMatch(form, /email us/i);
});

test("/apply is where a pilot is asked for, with the form's throttle and limits unchanged", async () => {
  const page = readFileSync("src/app/apply/page.tsx", "utf8");
  assert.match(page, /ask for a pilot/i);
  assert.match(page, /kind="trial_application"/);
  assert.match(page, /shared across every workspace you own/);
  const { APPLY_LIMIT, APPLY_ADDRESS_LIMIT } = await import("../src/lib/support/throttle.ts");
  assert.deepEqual([APPLY_LIMIT.max, APPLY_ADDRESS_LIMIT.max], [3, 10]);
  assert.match(readFileSync("src/app/solutions/agency/page.tsx", "utf8"), /href: "\/apply", label: "Ask for a pilot"/);
});

// ------------------------------------------------------------------ copy against mechanics

test("what a run costs is said the same way everywhere: the trial, then a plan or a grant", () => {
  // Before D3 an own key ran unmetered after the trial; these sentences still said so.
  const stale = /uses one of your trial runs, or grades on your own model key|uses a trial run or grades on your own model key|uses a trial run, or grades on your workspace's own model key|spends a trial run or grading on the workspace's own model key/;
  for (const path of [...files("data/docs", /\.md$/), "src/app/(app)/settings/api-keys.tsx", "src/lib/mcp/tools.ts"]) {
    assert.doesNotMatch(readFileSync(path, "utf8").replace(/\s+/g, " "), stale, path);
  }
});

test("the home page's run time is the measured one, and the trial's sharing is stated where clients are added", () => {
  const workflow = readFileSync("src/app/_home/workflow.tsx", "utf8");
  assert.match(workflow, /title: "Run the suite"[^}]*time: "a few minutes"/);
  assert.doesNotMatch(readFileSync("src/app/page.tsx", "utf8"), /in 30 seconds|30-second report/i);
  const workspaces = readFileSync("src/app/(app)/workspaces/page.tsx", "utf8");
  assert.match(workspaces, /shared across every workspace you own, not three per workspace/);
  // A pilot from a code is the owner's, for every workspace they own (0076); a plan stays per workspace.
  assert.match(workspaces, /A pilot redeemed from a code is shared the same way/);
  assert.match(workspaces, /covers that workspace only/);
});
