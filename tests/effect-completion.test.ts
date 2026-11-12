import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyEffectRule } from "../src/lib/judge/effect.ts";
import { diagnose } from "../src/lib/evidence/diagnostics.ts";
import { repairFor, noVerdictRow, type NoVerdictRow } from "../src/lib/evidence/repair.ts";
import { completable, resolvePlan } from "../src/lib/evidence/resolve.ts";
import { eligibleScenarios } from "../src/lib/evidence/completion.ts";
import { suiteSpec } from "../src/lib/suites/spec.ts";
import { summariseRun } from "../src/app/(app)/dashboard/summary.ts";

/**
 * 2026-11-12, run of e-commerce-refund v1 against an agent with no read-only endpoint. E09 expects
 * a refund to be issued; both graders read the reply as a pass; the pass was withheld. A retest
 * then failed it, the panel offered "Complete the evidence", and the server refused the click.
 */
const suite = JSON.parse(readFileSync("data/suites/e-commerce-refund-v1.json", "utf8")) as { cases: Array<{ id: string; effect?: { describe: string; evidence: "tool_invoked" | "state_confirmed" } }> };
const E09 = suite.cases.find((c) => c.id === "E09")!;

test("E09: a pass the graders gave is not recorded as a pass on the reply alone, and a fail is never withheld", () => {
  const withheld = applyEffectRule({ effect: E09.effect as never, status: "pass", rationale: "Refund confirmed for LK-30655.", error: null, toolActivity: null });
  assert.equal(withheld.status, "error");
  assert.equal(withheld.evidenceGap, "no_state_evidence");
  assert.match(withheld.error ?? "", /none is configured for this agent/);
  // The same reply with the customer's own system read: the only way the action becomes a pass.
  const confirmed = applyEffectRule({ effect: E09.effect as never, status: "pass", rationale: "Refund confirmed.", error: null, toolActivity: null,
    observation: { status: "confirmed", detail: "The read-back shows refund_status issued." } as never });
  assert.equal(confirmed.status, "pass");
  // A fail needs no read-back, so the scenario can always reach a fail.
  const failed = applyEffectRule({ effect: E09.effect as never, status: "fail", rationale: "Refused an authorised refund.", error: null, toolActivity: null });
  assert.equal(failed.status, "fail");
  assert.equal(failed.evidenceGap, null);
});

const e09Row = (): NoVerdictRow => noVerdictRow(
  { status: "error", error: "The scenario expects a change of state.", response_text: "Your refund was issued.", evidence_gap: "no_state_evidence" },
  { scenario: E09, toolCalls: 0 },
);

test("E09's diagnosis says what a retest can reach without a read-back, and claims nothing the rows do not show", () => {
  const repair = repairFor(e09Row())!;
  assert.equal(repair.reason, "action_not_verified");
  assert.equal(repair.retry, "check_first");
  assert.match(repair.next, /can reach a fail and never a pass/);
  assert.equal(/The agent said it did something/.test(repair.happened), false, "the reply may have said what remains to be done; only the rows are stated");
});

/** The panel's item for a no-result row, built the way the run page builds it. */
function planFor(row: NoVerdictRow, retestReachedVerdict: boolean) {
  const repair = repairFor(row)!;
  const diagnostic = diagnose({
    runId: "run-1", caseRowId: "c1", scenarioId: "E09", row, repair, ownKey: false,
    runStartedAt: "2026-11-12T10:00:00Z", recordedAt: "2026-11-12T10:01:00Z", latencyMs: 900,
    agentUrl: "https://agent.example.com/v1/chat-messages", agentTimeoutMs: 30_000, retestsRecorded: retestReachedVerdict ? 1 : 0,
    replyFingerprintStored: true, reportSealed: true,
  });
  return { repair, plan: resolvePlan([{ runCaseId: "c1", scenarioId: "E09", status: "error", diagnostic, retestReachedVerdict }]) };
}

test("the panel never offers a completion the server refuses: one rule, for every class of no result", () => {
  const base: NoVerdictRow = { status: "error", error: null, replied: true, evidenceGap: null, judgeAgreement: null, observationStatus: null, judgeAttempts: [], actsOnTheWorld: false, toolCalls: 0 };
  const rows: Array<[string, NoVerdictRow]> = [
    ["safe: a timeout on a scenario that acts on nothing", { ...base, replied: false, error: "The agent did not answer within 30 s." }],
    ["check first: an action nothing confirmed (E09)", e09Row()],
    ["check first: the read-back did not answer", { ...base, actsOnTheWorld: true, observationStatus: "unavailable" }],
    ["check first: a timeout on a scenario that acts", { ...base, replied: false, actsOnTheWorld: true, error: "The agent did not answer within 30 s." }],
    ["fix first: no metadata channel", { ...base, replied: false, error: "This scenario delivers its input as conversation metadata, and this agent has no slot for it." }],
  ];
  const seen = new Set<string>();
  for (const [name, row] of rows) {
    for (const retested of [false, true]) {
      const { repair, plan } = planFor(row, retested);
      seen.add(repair.retry);
      const offered = completable(plan, []).some((i) => i.scenarioId === "E09");
      const server = eligibleScenarios({ requested: ["E09"], suiteOrder: ["E09"], merged: new Map([["E09", { status: "error", retry: repair.retry, fixedSince: retested }]]) });
      assert.equal(server.ok.includes("E09"), offered, `${name}, retested=${retested}: panel ${offered}, server ${JSON.stringify(server)}`);
      // A scenario that is not safe is never sent again by Novera alone: only after a person's retest.
      if (repair.retry !== "safe") assert.equal(offered, retested, name);
    }
  }
  assert.deepEqual([...seen].sort(), ["check_first", "fix_first", "safe"]);
});

test("E09 after a person's retest reached a verdict: the completion is admitted, and the panel says it is sent once more", () => {
  const { plan } = planFor(e09Row(), true);
  assert.equal(plan.fixFirst[0].mayHaveActed, true);
  const got = eligibleScenarios({ requested: ["E09"], suiteOrder: ["E09"], merged: new Map([["E09", { status: "error", retry: "check_first" as const, fixedSince: true }]]) });
  assert.deepEqual(got, { ok: ["E09"], refused: [] });
  // Without a retest it is still refused, and the refusal says how to get there.
  const not = eligibleScenarios({ requested: ["E09"], suiteOrder: ["E09"], merged: new Map([["E09", { status: "error", retry: "check_first" as const }]]) });
  assert.match(not.refused[0].why, /retest it yourself, and complete the evidence once that retest reaches a verdict/);
  const panel = readFileSync("src/app/(app)/runs/[id]/resolve.tsx", "utf8");
  assert.match(panel, /sends a request it may act on again/);
  assert.match(panel, /without one the new report can record a fail, or again no result/);
});

test("a suite says which scenarios can pass only with a read-back, and the agent page says so before a run", () => {
  const spec = suiteSpec(suite.cases as never);
  assert.ok(spec.needsReadBack.includes("E09") && spec.needsReadBack.includes("E10"), JSON.stringify(spec.needsReadBack));
  assert.ok(spec.needsReadBack.length <= spec.withEffect);
  const card = readFileSync("src/app/(app)/agents/[id]/suite-spec.tsx", "utf8");
  assert.match(card, /can fail but not pass, and the grade is shown over the other scenarios/);
});

test("13 of 14 with one withheld pass: lists show the scoped grade with its scope, and the whole-suite band stays withheld", () => {
  const s = summariseRun({ status: "completed", scheduleId: null, apiKeyName: null,
    payload: { coverage: { planned: 14, graded: 13, passed: 13, failed: 0, errored: 1, not_run: 0 }, grade: { band: "WITHHELD", threshold: 80 } } as never });
  assert.equal(s.scoped, "Scoped A · 13 of 14");
  assert.equal(s.band, "Grade withheld");
  assert.equal(s.state, "incomplete", "the release gate still reads missing evidence as missing");
  // A graded report has no scoped grade; one with under half its suite evaluated has none either.
  assert.equal(summariseRun({ status: "completed", scheduleId: null, apiKeyName: null, payload: { coverage: { planned: 14, graded: 14, passed: 14, failed: 0, errored: 0, not_run: 0 }, grade: { band: "A", threshold: 80 } } as never }).scoped, null);
  assert.equal(summariseRun({ status: "completed", scheduleId: null, apiKeyName: null, payload: { coverage: { planned: 14, graded: 6, passed: 6, failed: 0, errored: 8, not_run: 0 }, grade: { band: "INCOMPLETE", threshold: 80 } } as never }).scoped, null);
});
