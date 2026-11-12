import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveOutcomes, resolvePlan, resolveSummary } from "../src/lib/evidence/resolve.ts";
import { diagnose, type DiagnosticReport } from "../src/lib/evidence/diagnostics.ts";
import { repairFor, type NoVerdictRow, type RepairReason } from "../src/lib/evidence/repair.ts";
import { verdictWords } from "../src/lib/checks/single.ts";

/** A real diagnosis for a reason, through the same functions the run page uses. */
function diagnosisFor(reason: RepairReason, scenarioId = "T01"): DiagnosticReport {
  const base: NoVerdictRow = { status: "error", error: null, replied: false, evidenceGap: null, judgeAgreement: null, judgeAttempts: [], actsOnTheWorld: false, toolCalls: 0 };
  // Each row carries the sentence the runner actually stores for that reason (src/lib/evidence/repair.ts).
  const rows: Partial<Record<RepairReason, NoVerdictRow>> = {
    agent_timeout: { ...base, error: "The agent did not answer within 30 s." },
    graders_rate_limited: { ...base, replied: true, error: "No grader could answer.", judgeAttempts: [{ ok: false, reason: "rate_limited" }, { ok: false, reason: "rate_limited" }] },
    not_sent_address: { ...base, error: "Not sent: agent.example points to a private or internal address." },
    production_guard: { ...base, error: "This scenario attempts something irreversible, and the agent is marked production." },
  };
  const row = rows[reason];
  if (!row) throw new Error(`no fixture for ${reason}`);
  const repair = repairFor(row);
  assert.equal(repair?.reason, reason, "the fixture is classified as the reason it stands for");
  if (!repair) throw new Error(`no repair for ${reason}`);
  return diagnose({
    runId: "r1", caseRowId: `c-${scenarioId}`, scenarioId, row, repair, ownKey: false, runStartedAt: "2026-11-10T10:00:00.000Z",
    recordedAt: "2026-11-10T10:00:05.000Z", latencyMs: null, agentUrl: "https://agent.example/chat", agentTimeoutMs: 30_000,
    retestsRecorded: 0, replyFingerprintStored: false, reportSealed: true,
  });
}

test("the plan splits no-result scenarios by whether a retest is safe, and ignores scenarios with a verdict", () => {
  const timeout = diagnosisFor("agent_timeout", "T01");
  const address = diagnosisFor("not_sent_address", "T02");
  const guard = diagnosisFor("production_guard", "T06");
  assert.equal(timeout.retryPolicy.isSafeToRetry, true, "a timeout on a scenario that acts on nothing is safe to retest");
  assert.equal(address.retryPolicy.isSafeToRetry, false);
  assert.equal(guard.retryPolicy.isSafeToRetry, false);
  const plan = resolvePlan([
    { runCaseId: "c1", scenarioId: "T01", status: "error", diagnostic: timeout },
    { runCaseId: "c2", scenarioId: "T02", status: "error", diagnostic: address },
    { runCaseId: "c3", scenarioId: "T03", status: "fail", diagnostic: null },
    { runCaseId: "c4", scenarioId: "T04", status: "pass", diagnostic: null },
    { runCaseId: "c5", scenarioId: "T05", status: "error", diagnostic: null },
    { runCaseId: "c6", scenarioId: "T06", status: "error", diagnostic: guard },
  ]);
  assert.deepEqual(plan.retestable.map((i) => i.scenarioId), ["T01"]);
  assert.deepEqual(plan.fixFirst.map((i) => i.scenarioId), ["T02", "T06"], "configuration gaps are never retested");
  for (const item of [...plan.retestable, ...plan.fixFirst]) {
    assert.ok(item.step.length > 0, `${item.scenarioId} carries the one thing to do`);
    assert.ok(item.headline.length > 0);
  }
  for (const item of plan.fixFirst) assert.ok(item.blocked, `${item.scenarioId} says why a retest would repeat the answer`);
  for (const item of plan.retestable) assert.equal(item.blocked, null);
  assert.equal(plan.fixFirst[0].category, "BLOCKED_CONFIG");
  assert.equal(plan.fixFirst[1].category, "NOT_RUN");
});

test("outcomes are derived from retest rows recorded since the panel opened, newest per scenario", () => {
  const plan = resolvePlan([
    { runCaseId: "c1", scenarioId: "T01", status: "error", diagnostic: diagnosisFor("agent_timeout", "T01") },
    { runCaseId: "c2", scenarioId: "T02", status: "error", diagnostic: diagnosisFor("graders_rate_limited", "T02") },
  ]);
  assert.equal(plan.retestable.length, 2, "both reasons are retest-safe");
  const since = "2026-11-10T12:00:00.000Z";
  const retests = [
    { run_case_id: "c1", status: "fail", created_at: "2026-11-10T11:00:00.000Z", rationale: "old" },           // before: ignored
    { run_case_id: "c1", status: "pass", created_at: "2026-11-10T12:00:10.000Z", rationale: "Declined politely." },
    { run_case_id: "c2", status: "error", judge_agreement: "unresolved", created_at: "2026-11-10T12:00:30.000Z", error: null },
    { run_case_id: "c9", status: "pass", created_at: "2026-11-10T12:00:40.000Z" },                             // another case
  ];
  const outcomes = resolveOutcomes(plan, retests, since);
  const disputed = verdictWords("no_verdict", "disputed");
  assert.deepEqual(outcomes.map((o) => [o.scenarioId, o.verdict, o.words]), [
    // Said as what happened: a verdict was reached (and which), or there is still no result (and why).
    ["T01", "pass", "Verdict reached: passed"],
    ["T02", "no_verdict", `No result again: ${disputed.replace(/^No verdict: /, "")}`],
  ]);
  assert.equal(outcomes[0].detail, "Declined politely.");
  const none = resolveOutcomes(plan, [], since);
  assert.deepEqual(none.map((o) => o.verdict), [null, null]);
  assert.equal(none[0].words, "Not retested yet");
});

test("the summary counts transient gaps, remaining gaps, pending retests and fixes, and never says the report changed", () => {
  const plan = resolvePlan([
    { runCaseId: "c1", scenarioId: "T01", status: "error", diagnostic: diagnosisFor("agent_timeout", "T01") },
    { runCaseId: "c2", scenarioId: "T02", status: "error", diagnostic: diagnosisFor("graders_rate_limited", "T02") },
    { runCaseId: "c3", scenarioId: "T03", status: "error", diagnostic: diagnosisFor("not_sent_address", "T03") },
  ]);
  const outcomes = resolveOutcomes(plan, [
    { run_case_id: "c1", status: "pass", created_at: "2026-11-10T12:00:10.000Z" },
    { run_case_id: "c2", status: "error", judge_agreement: "unresolved", created_at: "2026-11-10T12:00:30.000Z" },
  ], "2026-11-10T12:00:00.000Z");
  const s = resolveSummary(outcomes, plan);
  assert.match(s, /^1 of 2 retested scenarios reached a verdict, so that gap was transient; 1 still produced no result; 1 needs a fix first\./);
  assert.match(s, /A retest never changes this report/);
  assert.match(resolveSummary(resolveOutcomes(plan, [], "2026-11-10T12:00:00.000Z"), plan), /2 not retested yet; 1 needs a fix first/);
  const empty = resolvePlan([]);
  assert.match(resolveSummary([], empty), /^Nothing to resolve\./);
  for (const forbidden of [/who graded/i, /something went wrong/i, /try again later/i, /check your settings/i]) assert.doesNotMatch(s, forbidden);
});
