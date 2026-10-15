import { test } from "node:test";
import assert from "node:assert/strict";
import { compareRuns } from "../src/lib/evidence/compare.ts";

test("a policy fix that breaks something else surfaces both outcomes", () => {
  const diff = compareRuns(
    [
      { caseId: "T01", status: "pass" },
      { caseId: "T09", status: "fail" },
      { caseId: "T13", status: "fail" },
    ],
    [
      { caseId: "T01", status: "fail" },
      { caseId: "T09", status: "pass" },
      { caseId: "T13", status: "fail" },
    ],
  );

  assert.deepEqual(diff.fixed, ["T09"]);
  assert.deepEqual(diff.newFailures, ["T01"]);
  assert.deepEqual(diff.persistentFailures, ["T13"]);
  assert.equal(diff.comparable, true);
});

test("an error becoming a pass counts as fixed, and a new error is flagged", () => {
  const diff = compareRuns(
    [
      { caseId: "T02", status: "error" },
      { caseId: "T05", status: "pass" },
    ],
    [
      { caseId: "T02", status: "pass" },
      { caseId: "T05", status: "error" },
    ],
  );

  assert.deepEqual(diff.fixed, ["T02"]);
  assert.deepEqual(diff.errorResolved, ["T02"]);
  assert.deepEqual(diff.nowErrored, ["T05"]);
  // An error is not a failure; T05 must not appear as a new failure.
  assert.deepEqual(diff.newFailures, []);
});

test("changing the suite between runs makes the comparison partial and says so", () => {
  const diff = compareRuns(
    [{ caseId: "T01", status: "fail" }, { caseId: "T02", status: "fail" }],
    [{ caseId: "T01", status: "pass" }, { caseId: "T99", status: "pass" }],
  );

  assert.deepEqual(diff.notInBaseline, ["T99"]);
  assert.deepEqual(diff.missingFromCurrent, ["T02"]);
  assert.equal(diff.comparable, false);
});

test("a moved verdict is the agent only when its reply changed", async () => {
  const { causeOfMove } = await import("../src/lib/evidence/compare.ts");
  const e = (status: "pass" | "fail" | "error", replySha: string | null, extra: Partial<{ replied: boolean; observation: string | null }> = {}) =>
    ({ status, replySha, replied: true, observation: null, ...extra });
  assert.equal(causeOfMove(e("pass", "aaa"), e("fail", "aaa")), "graders_changed");
  assert.equal(causeOfMove(e("pass", "aaa"), e("fail", "bbb")), "agent_changed");
  assert.equal(causeOfMove(e("pass", null), e("fail", "bbb")), "unknown");
  assert.equal(causeOfMove(e("pass", "aaa"), e("error", null, { replied: false })), "no_reply");
  assert.equal(causeOfMove(e("pass", "aaa", { observation: "confirmed" }), e("error", "aaa", { observation: "unavailable" })), "readback_unavailable");
});

test("what else changed between two runs is read from their manifests", async () => {
  const { contextChanges } = await import("../src/lib/evidence/compare.ts");
  const m = (over: Record<string, unknown> = {}) => ({ rubric_hash: "r1", judge_plan: [{ connection: "groq", model: "groq/a", task: "judge" }], agent: { config_hash: "c1" }, ...over });
  assert.deepEqual(contextChanges({ policyVersion: 2, manifest: m() }, { policyVersion: 2, manifest: m() }), []);
  const changed = contextChanges(
    { policyVersion: 2, manifest: m() },
    { policyVersion: 3, manifest: m({ rubric_hash: "r2", judge_plan: [{ connection: "mistral", model: "mistral/b", task: "judge" }], agent: { config_hash: "c2" }, declared: { release_id: "v9" } }) },
  );
  assert.equal(changed.length, 5);
  assert.match(changed[0], /v2 → v3/);
  assert.match(changed.join(" "), /rubric, not the agent/);
  assert.match(changed.join(" "), /groq\/a → mistral\/b/);
  assert.match(contextChanges({ policyVersion: 1, manifest: null }, { policyVersion: 1, manifest: m() })[0], /predates the declared manifest/);
});

// ------------------------------------------------------------------ scenario deltas

import {
  configurationDiff, DELTA_CATEGORIES, deltaSummary, deltasInView, medianOf, replyMatch, scenarioDeltas, viewCounts,
  type DeltaRun, type ScenarioDeltas, type ScenarioEvidence,
} from "../src/lib/evidence/compare.ts";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";

const ev = (status: "pass" | "fail" | "error", sha: string | null, over: Partial<ScenarioEvidence> = {}): ScenarioEvidence =>
  ({ status, replied: sha !== null, rawSha: sha, contentSha: sha, conversation: false, observation: null, ...over });

function side(
  runId: string,
  cases: Record<string, ScenarioEvidence | null>,
  over: { agentId?: string; key?: string; version?: number; owner?: string | null; digests?: Record<string, string>; severity?: Record<string, string> } = {},
): DeltaRun {
  return {
    runId,
    agentId: over.agentId ?? "agent-1",
    suite: { key: over.key ?? "eu-support", version: over.version ?? 5, owner: over.owner === undefined ? null : over.owner },
    scenarios: Object.keys(cases).map((id) => ({ id, digest: over.digests?.[id] ?? `d-${id}`, severity: over.severity?.[id] ?? "medium" })),
    cases: new Map(Object.entries(cases).filter((e): e is [string, ScenarioEvidence] => e[1] !== null)),
  };
}

const ok = (r: ReturnType<typeof scenarioDeltas>): ScenarioDeltas => {
  assert.equal(r.ok, true, r.ok ? "" : r.sentence);
  return r as ScenarioDeltas;
};
const cat = (d: ScenarioDeltas, id: string) => d.deltas.find((x) => x.caseId === id)?.category;

test("every scenario lands in exactly one category, and an identical reply is never a fix or a regression", () => {
  const d = ok(scenarioDeltas(
    side("base", {
      R1: ev("pass", "a"), M1: ev("pass", "b"), M2: ev("fail", "c"), F1: ev("fail", "d"), P1: ev("fail", "e"), U1: ev("pass", "f"),
      N1: ev("pass", "g"), N2: ev("error", null), A1: ev("error", null), A2: ev("error", "h"), A3: ev("error", null), F2: ev("error", "i"),
      X1: ev("pass", "j"),
    }),
    side("target", {
      R1: ev("fail", "a2"), M1: ev("fail", "b"), M2: ev("pass", "c"), F1: ev("pass", "d2"), P1: ev("fail", "e"), U1: ev("pass", "f"),
      N1: ev("error", null), N2: ev("error", null), A1: ev("fail", "x"), A2: ev("pass", "h"), A3: ev("pass", "y"), F2: ev("pass", "i2"),
      X1: null,
    }),
  ));
  assert.equal(cat(d, "R1"), "regressed");
  assert.equal(cat(d, "M1"), "verdict_moved_same_reply");
  assert.equal(cat(d, "M2"), "verdict_moved_same_reply");
  assert.equal(cat(d, "F1"), "fixed");
  assert.equal(cat(d, "P1"), "persistent_failure");
  assert.equal(cat(d, "U1"), "unchanged_pass");
  assert.equal(cat(d, "N1"), "no_result_now");
  assert.equal(cat(d, "N2"), "no_result_now", "no result in either run is still no result now");
  assert.equal(cat(d, "A1"), "result_again");
  assert.equal(cat(d, "A2"), "result_again", "graders settling an identical reply they could not settle before is not a fix");
  assert.equal(cat(d, "A3"), "result_again", "a scenario the agent never answered was never shown broken, so passing now is not a fix");
  assert.equal(cat(d, "F2"), "fixed", "no result on one reply, a pass on a different reply: fixed");
  assert.equal(cat(d, "X1"), "no_result_now", "a scenario the run never recorded has no result now");
  assert.equal(d.deltas.find((x) => x.caseId === "X1")?.target, "not_run");
  assert.equal(d.deltas.find((x) => x.caseId === "M1")?.cause, "graders_changed");
  assert.equal(d.deltas.find((x) => x.caseId === "R1")?.cause, "agent_changed");
  assert.equal(d.deltas.length, 13);
  assert.equal(Object.values(d.counts).reduce((a, b) => a + b, 0), 13);
  assert.deepEqual(DELTA_CATEGORIES.filter((c) => d.counts[c] > 0).sort(),
    ["fixed", "no_result_now", "persistent_failure", "regressed", "result_again", "unchanged_pass", "verdict_moved_same_reply"]);
  assert.equal(d.crossVersion, false);
  assert.equal(d.definitions.match, true);
});

test("a pass that fails is a regression unless the reply is shown identical; not knowing never hides one", () => {
  const conv = { conversation: true };
  const d = ok(scenarioDeltas(
    side("b", { T1: ev("pass", null, { replied: true }), T2: ev("pass", "s1", { contentSha: null, ...conv }), T3: ev("pass", "s1", { contentSha: "w" , ...conv}) }),
    side("t", { T1: ev("fail", "z"), T2: ev("fail", "s2", { contentSha: null, ...conv }), T3: ev("fail", "s2", { contentSha: "w", ...conv }) }),
  ));
  assert.equal(cat(d, "T1"), "regressed");
  assert.equal(d.deltas.find((x) => x.caseId === "T1")?.cause, "unknown");
  // A conversation's stored fingerprint covers turn timing: once emptied, different is not shown different.
  assert.equal(cat(d, "T2"), "regressed");
  assert.equal(d.deltas.find((x) => x.caseId === "T2")?.reply, "unknown");
  // While held, the words are fingerprinted without the timing and are the same: the graders moved.
  assert.equal(cat(d, "T3"), "verdict_moved_same_reply");
});

test("an identical reply with a different read-back is the customer's system, and still counts", () => {
  const d = ok(scenarioDeltas(
    side("b", { E1: ev("pass", "a", { observation: "confirmed" }) }),
    side("t", { E1: ev("fail", "a", { observation: "contradicted" }) }),
  ));
  assert.equal(cat(d, "E1"), "regressed");
  assert.equal(d.deltas[0].cause, "readback_changed");
});

test("replyMatch claims sameness only on equal fingerprints of two replies that exist", () => {
  assert.equal(replyMatch(ev("pass", "a"), ev("fail", "a")), "same");
  assert.equal(replyMatch(ev("pass", "a"), ev("fail", "b")), "changed");
  assert.equal(replyMatch(ev("error", null), ev("error", null)), "unknown");
  // One side emptied: the stored fingerprints are compared instead.
  assert.equal(replyMatch(ev("pass", "a", { contentSha: null }), ev("fail", "a", { contentSha: "zz" })), "same");
  assert.equal(replyMatch(ev("pass", "a", { contentSha: null }), ev("fail", "b", { contentSha: "zz" })), "changed");
});

test("across suite versions only identically defined scenarios are compared", () => {
  const d = ok(scenarioDeltas(
    side("b", { T1: ev("pass", "a"), T2: ev("pass", "b"), T3: ev("fail", "c") }, { version: 4, digests: { T2: "old" } }),
    side("t", { T1: ev("fail", "a2"), T2: ev("fail", "b2"), T4: ev("pass", "d") }, { version: 5, digests: { T2: "new" }, severity: { T1: "critical" } }),
  ));
  assert.equal(d.crossVersion, true);
  assert.equal(cat(d, "T1"), "regressed");
  assert.equal(cat(d, "T2"), "redefined", "the same id with another definition is a different test");
  assert.equal(cat(d, "T3"), "retired");
  assert.equal(cat(d, "T4"), "added");
  assert.deepEqual(d.definitions, { shared: 2, identical: 1, redefined: 1, added: 1, retired: 1, match: false });
  assert.equal(d.counts.regressed, 1, "a redefined scenario that went pass → fail is not a regression");
  assert.deepEqual(d.regressionsBySeverity, { critical: 1, high: 0, medium: 0, low: 0 });
  assert.equal(d.comparedPasses, 1);
  const redefined = d.deltas.find((x) => x.caseId === "T2")!;
  assert.equal(redefined.base, "pass");
  assert.equal(redefined.target, "fail");
  assert.equal(redefined.cause, null);
  assert.deepEqual(deltasInView(d, "definition").map((x) => x.caseId).sort(), ["T2", "T3", "T4"]);
  assert.equal(viewCounts(d).regressed, 1);
  assert.equal(viewCounts(d).all, 4);
});

test("a different agent, another suite or the same run is refused with a sentence", () => {
  const a = side("b", { T1: ev("pass", "a") });
  const other = (r: ReturnType<typeof scenarioDeltas>) => (r.ok ? null : r);
  const agent = other(scenarioDeltas(a, side("t", { T1: ev("fail", "b") }, { agentId: "agent-2" })));
  assert.equal(agent?.reason, "different_agent");
  assert.match(agent!.sentence, /not a regression of this one/);
  assert.equal(other(scenarioDeltas(a, side("t", { T1: ev("fail", "b") }, { key: "docs-support" })))?.reason, "different_suite");
  assert.equal(other(scenarioDeltas(a, side("t", { T1: ev("fail", "b") }, { owner: "ws-1" })))?.reason, "different_suite",
    "a workspace suite is not the built-in one that happens to share its key");
  assert.equal(other(scenarioDeltas(a, side("b", { T1: ev("fail", "b") })))?.reason, "same_run");
});

test("the summary says whether anything that passed now fails, and keeps grader moves apart", () => {
  const clean = ok(scenarioDeltas(side("b", { T1: ev("pass", "a"), T2: ev("fail", "b") }), side("t", { T1: ev("pass", "a"), T2: ev("pass", "c") })));
  assert.equal(deltaSummary(clean).headline, "No previously passing scenario failed.");
  assert.equal(deltaSummary(clean).tone, "pass");

  const moved = ok(scenarioDeltas(side("b", { T1: ev("pass", "a"), T2: ev("fail", "b") }), side("t", { T1: ev("fail", "a"), T2: ev("fail", "b") })));
  const s = deltaSummary(moved);
  assert.equal(s.headline, "No previously passing scenario failed with a changed reply.");
  assert.ok(s.lines.includes("1 verdict moved on an identical reply — graders, not the agent."));

  const broke = ok(scenarioDeltas(side("b", { T1: ev("pass", "a"), T2: ev("pass", "b") }), side("t", { T1: ev("fail", "x"), T2: ev("fail", "y") })));
  assert.equal(deltaSummary(broke).headline, "2 previously passing scenarios now fail.");
  assert.equal(deltaSummary(broke).tone, "fail");

  const nothing = ok(scenarioDeltas(side("b", { T1: ev("pass", "a") }, { digests: { T1: "x" } }), side("t", { T1: ev("pass", "a") }, { digests: { T1: "y" }, version: 6 })));
  assert.equal(deltaSummary(nothing).tone, "neutral");

  for (const d of [clean, moved, broke, nothing]) {
    const text = [deltaSummary(d).headline, ...deltaSummary(d).lines].join("\n");
    assert.deepEqual(scanCustomerLanguage(text), []);
    assert.doesNotMatch(text, /clearance|certified|compliant/i);
  }
});

test("the configuration diff adds the suite version and each run's median latency to contextChanges", () => {
  assert.equal(medianOf([900, null, 1100, 1000]), 1000);
  assert.equal(medianOf([900, 1000]), 950);
  assert.equal(medianOf([null]), null);
  const definitions = { shared: 3, identical: 3, redefined: 0, added: 0, retired: 0, match: true };
  const m = { rubric_hash: "r1", judge_plan: [{ model: "groq/a", task: "judge" }], agent: { config_hash: "c1" } };
  const diff = configurationDiff({
    base: { policyVersion: 2, manifest: m, suiteVersion: 4, medianLatencyMs: 900 },
    target: { policyVersion: 3, manifest: m, suiteVersion: 5, medianLatencyMs: 1200 },
    definitions,
  });
  assert.deepEqual(diff.changes, ["The suite version changed: v4 → v5, with every scenario defined the same way.", "The policy changed: v2 → v3."]);
  assert.deepEqual(diff.medianLatencyMs, [900, 1200]);
  assert.equal(diff.definitionsMatch, true);
});

test("compareRuns' output for the sealed report and the MCP tool is unchanged", () => {
  const diff = compareRuns(
    [
      { caseId: "T01", status: "pass" }, { caseId: "T02", status: "fail" }, { caseId: "T03", status: "error" },
      { caseId: "T04", status: "pass" }, { caseId: "T05", status: "error" }, { caseId: "T06", status: "fail" }, { caseId: "T07", status: "pass" },
    ],
    [
      { caseId: "T01", status: "fail" }, { caseId: "T02", status: "pass" }, { caseId: "T03", status: "pass" },
      { caseId: "T04", status: "error" }, { caseId: "T05", status: "fail" }, { caseId: "T06", status: "fail" }, { caseId: "T08", status: "pass" },
    ],
  );
  assert.deepEqual(diff, {
    fixed: ["T02", "T03"],
    persistentFailures: ["T06"],
    newFailures: ["T01"],
    nowErrored: ["T04"],
    errorResolved: ["T03", "T05"],
    notInBaseline: ["T08"],
    missingFromCurrent: ["T07"],
    comparable: false,
  });
  assert.deepEqual(Object.keys(diff), ["fixed", "persistentFailures", "newFailures", "nowErrored", "errorResolved", "notInBaseline", "missingFromCurrent", "comparable"]);
});

test("the loader's fingerprints ignore a conversation's timing and know an emptied row that held nothing", async () => {
  const { evidenceOf } = await import("../src/lib/evidence/comparison-loader.ts");
  const { createHash } = await import("node:crypto");
  const turns = (ms: number) => [{ role: "customer", content: "hi" }, { role: "agent", content: "hello", latencyMs: ms }];
  const a = evidenceOf({ status: "pass", response_text: "hello", transcript: turns(900), tool_activity: null, raw_sha256: "x1" }, null);
  const b = evidenceOf({ status: "fail", response_text: "hello", transcript: turns(1400), tool_activity: null, raw_sha256: "x2" }, null);
  assert.equal(a.conversation, true);
  assert.equal(replyMatch(a, b), "same");
  const empty = createHash("sha256").update("\u001f\u001f").digest("hex");
  const gone = evidenceOf({ status: "error", raw_expired_at: "2026-10-01T00:00:00Z", raw_sha256: empty }, null);
  assert.equal(gone.replied, false);
  assert.equal(gone.contentSha, null);
  const graded = evidenceOf({ status: "pass", raw_expired_at: "2026-10-01T00:00:00Z", raw_sha256: "abc" }, { earlier_turns: ["x"] } as never);
  assert.equal(graded.replied, true);
  assert.equal(graded.conversation, true, "an emptied conversation is known from its definition");
});
