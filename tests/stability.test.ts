import { test } from "node:test";
import assert from "node:assert/strict";
import { unstableCases, unstableInComparison, type HistoricalRun } from "../src/lib/evidence/stability.ts";

const run = (runId: string, policyId: string, statuses: Record<string, "pass" | "fail" | "error">): HistoricalRun => ({
  runId,
  policyId,
  cases: Object.entries(statuses).map(([caseId, status]) => ({ caseId, status })),
});

test("a scenario that passed and failed under one policy version is unstable", () => {
  const found = unstableCases([
    run("r1", "p2", { T01: "pass", T12: "pass" }),
    run("r2", "p2", { T01: "pass", T12: "fail" }),
  ]);
  assert.deepEqual([...found.keys()], ["T12"]);
  assert.deepEqual(found.get("T12"), { caseId: "T12", policyId: "p2", passes: 1, fails: 1, runs: 2 });
});

test("a change across policy versions is what a comparison is for, not instability", () => {
  // Pass under v2, fail under v3: that is exactly the regression the comparison should
  // report, and it must not be explained away.
  const found = unstableCases([
    run("r1", "p2", { T12: "pass" }),
    run("r2", "p3", { T12: "fail" }),
  ]);
  assert.equal(found.size, 0);
});

test("one run under a policy version is one sample and proves nothing", () => {
  assert.equal(unstableCases([run("r1", "p2", { T12: "pass" })]).size, 0);
});

test("an error is not a flip", () => {
  // No verdict was produced, so it is evidence of neither stability nor its absence.
  const found = unstableCases([
    run("r1", "p2", { T12: "pass" }),
    run("r2", "p2", { T12: "error" }),
    run("r3", "p2", { T12: "pass" }),
  ]);
  assert.equal(found.size, 0);
});

test("a flagged regression stays a regression", () => {
  // The annotation never removes a scenario from newly broken. Hiding a real
  // regression because a scenario has been flaky would be the worse error.
  const comparison = { fixed: ["T03"], newFailures: ["T12", "T20"] };
  const unstable = unstableCases([
    run("r1", "p2", { T12: "pass", T20: "pass" }),
    run("r2", "p2", { T12: "fail", T20: "pass" }),
  ]);
  assert.deepEqual(unstableInComparison(comparison, unstable), ["T12"]);
  assert.deepEqual(comparison.newFailures, ["T12", "T20"]);
});

test("the strongest evidence is kept when a scenario flipped under two versions", () => {
  const found = unstableCases([
    run("a", "p1", { T05: "pass" }), run("b", "p1", { T05: "fail" }),
    run("c", "p2", { T05: "pass" }), run("d", "p2", { T05: "fail" }), run("e", "p2", { T05: "pass" }),
  ]);
  assert.equal(found.get("T05")?.policyId, "p2");
  assert.equal(found.get("T05")?.runs, 3);
});

test("an identical reply graded both ways is the graders moving; different replies, the agent", () => {
  const withSha = (runId: string, status: "pass" | "fail", replySha: string | null): HistoricalRun =>
    ({ runId, policyId: "p", cases: [{ caseId: "T07", status, replySha }] });
  assert.equal(unstableCases([withSha("a", "pass", "x"), withSha("b", "fail", "x")]).get("T07")?.cause, "graders");
  assert.equal(unstableCases([withSha("a", "pass", "x"), withSha("b", "fail", "y")]).get("T07")?.cause, "agent");
  // A missing fingerprint cannot rule the graders out, so nothing is claimed.
  assert.equal(unstableCases([withSha("a", "pass", "x"), withSha("b", "fail", null)]).get("T07")?.cause, undefined);
  // Old history without fingerprints keeps working and says less.
  assert.equal(unstableCases([run("a", "p", { T07: "pass" }), run("b", "p", { T07: "fail" })]).get("T07")?.cause, undefined);
});
