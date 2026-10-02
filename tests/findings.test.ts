import { test } from "node:test";
import assert from "node:assert/strict";
import { testFindings, type FindingRun, type CaseStatus } from "../src/lib/review/findings.ts";

const run = (id: string, agentId: string, suiteId: string, statuses: Record<string, CaseStatus>, severity = "high"): FindingRun => ({
  id, agentId, agentName: agentId, suiteId, createdAt: id,
  cases: new Map(Object.entries(statuses).map(([caseId, status]) => [caseId, { runCaseId: `${id}:${caseId}`, status, severity, obligation: null }])),
});

test("a failure is new, recurring or not comparable by the previous run of the same suite version", () => {
  const f = testFindings([
    run("r3", "a", "s1", { T1: "fail", T2: "fail", T3: "fail", T4: "pass" }),
    run("r2", "a", "s1", { T1: "pass", T2: "fail", T3: "error", T4: "fail" }),
    run("r1", "a", "s1", { T1: "pass", T2: "fail", T3: "pass", T4: "fail" }),
  ], new Map());
  const by = Object.fromEntries(f.map((x) => [x.caseId, x]));
  assert.equal(by.T1.state, "new");
  assert.equal(by.T2.state, "recurring");
  assert.equal(by.T2.streak, 3);
  assert.equal(by.T3.state, "not_comparable", "no verdict last time is not a comparison");
  assert.equal(by.T4.state, "resolved");
  assert.deepEqual(f.map((x) => x.state), ["new", "recurring", "not_comparable", "resolved"]);
});

test("a run of another suite version is never the baseline", () => {
  const f = testFindings([
    run("r2", "a", "s2", { T1: "fail" }),
    run("r1", "a", "s1", { T1: "pass" }),
  ], new Map());
  assert.equal(f[0].state, "not_comparable");
  assert.equal(f[0].previousRunId, null);
});

test("agents are compared only with themselves, and a no-verdict case is not a finding", () => {
  const f = testFindings([
    run("b1", "b", "s1", { T1: "error" }),
    run("a2", "a", "s1", { T1: "fail" }),
    run("a1", "a", "s1", { T1: "fail" }),
  ], new Map());
  assert.equal(f.length, 1);
  assert.equal(f[0].agentId, "a");
  assert.equal(f[0].state, "recurring");
});

test("the next step follows what a person has already done, and links to the scenario itself", () => {
  const latest = run("r2", "a", "s1", { T1: "fail", T2: "fail", T3: "fail", T4: "fail", T5: "fail" });
  const f = testFindings([latest, run("r1", "a", "s1", {})], new Map([
    ["r2:T2", { proposal: "proposed" as const }],
    ["r2:T3", { proposal: "approved" as const }],
    ["r2:T4", { proposal: "approved" as const, retest: "pass" as const }],
    ["r2:T5", { finding: "pass" as const }],
  ]));
  const next = Object.fromEntries(f.map((x) => [x.caseId, x.next]));
  assert.deepEqual(next.T1, { label: "Inspect and ask why", href: "/runs/r2?case=T1" });
  assert.equal(next.T2.label, "Decide the proposed change");
  assert.equal(next.T3.label, "Retest against the new policy");
  assert.equal(next.T4.label, "Retest passed — rerun the suite to confirm");
  assert.equal(next.T4.href, "/agents/a");
  assert.match(next.T5.label, /finding is recorded/);
});

test("within a state, the most severe comes first", () => {
  const f = testFindings([
    { ...run("r1", "a", "s1", {}), cases: new Map([
      ["T1", { runCaseId: "1", status: "fail" as const, severity: "low", obligation: null }],
      ["T2", { runCaseId: "2", status: "fail" as const, severity: "critical", obligation: null }],
    ]) },
  ], new Map());
  assert.deepEqual(f.map((x) => x.caseId), ["T2", "T1"]);
});
