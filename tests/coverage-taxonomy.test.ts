import { test } from "node:test";
import assert from "node:assert/strict";
import { coverage } from "../src/lib/evidence/coverage.ts";

test("a deadlocked verdict is counted as disputed as well as errored", () => {
  // Two models disagreed and a third could not settle it. That is a different fact
  // about the agent from a dead endpoint, and only one of them is the customer's to fix.
  const result = coverage({
    plannedCases: 4,
    cases: [
      { status: "pass" },
      { status: "fail" },
      { status: "error", agreement: "unresolved" },
      { status: "error", agreement: null },
    ],
  });
  assert.equal(result.errored, 2, "both are still no-verdict cases");
  assert.equal(result.disputed, 1, "only one of them was a deadlock");
  assert.match(result.basis, /two models disagreed/);
});

test("no deadlock means no mention of one", () => {
  const result = coverage({
    plannedCases: 2,
    cases: [{ status: "pass" }, { status: "error", agreement: null }],
  });
  assert.equal(result.disputed, 0);
  assert.doesNotMatch(result.basis, /disagreed/);
});

test("rows with no recorded agreement are never counted as disputed", () => {
  // Runs sealed before corroboration was recorded carry no agreement at all. Absence
  // of the field is not evidence of a deadlock.
  const result = coverage({ plannedCases: 1, cases: [{ status: "error" }] });
  assert.equal(result.disputed, 0);
});

test("the assurance gap is the share of the suite with no verdict", () => {
  const result = coverage({
    plannedCases: 10,
    cases: [
      { status: "pass" }, { status: "pass" }, { status: "pass" }, { status: "pass" },
      { status: "pass" }, { status: "pass" }, { status: "fail" }, { status: "error" },
    ],
  });
  // 1 errored + 2 never run = 3 of 10.
  assert.equal(result.errored, 1);
  assert.equal(result.notRun, 2);
  assert.equal(result.assuranceGap, 30);
});

test("a fully executed run has no assurance gap", () => {
  const result = coverage({
    plannedCases: 2,
    cases: [{ status: "pass" }, { status: "fail" }],
  });
  assert.equal(result.assuranceGap, 0);
});

test("a suite with nothing planned reports no gap rather than dividing by zero", () => {
  assert.equal(coverage({ plannedCases: 0, cases: [] }).assuranceGap, 0);
});

/* ------------------------------------------------- the three coverage numbers (1.2)
   `score` says how the graded cases did. None of these do — they say how much of the
   evaluation actually happened, which is the question a reviewer asks first. */

test("execution coverage counts what ran, whatever the verdict", () => {
  const c = coverage({
    plannedCases: 10,
    cases: [
      ...Array(6).fill({ status: "pass" as const }),
      { status: "fail" as const },
      { status: "error" as const },
    ],
    // 8 of 10 ran; the other 2 never started.
  });
  assert.equal(c.executionCoverage, 80);
  assert.equal(c.notRun, 2);
});

test("a fail that names no unmet assertion is graded but not resolved", () => {
  // The whole point of separating these: the case has a verdict and no reason, and a
  // pass rate would report it as perfectly well understood.
  const c = coverage({
    plannedCases: 2,
    cases: [
      { status: "pass", assertionCount: 3 },
      { status: "fail", assertionCount: 3, failedAssertionCount: 0 },
    ],
  });
  assert.equal(c.graded, 2, "both produced a verdict");
  assert.equal(c.resolutionCoverage, 50, "only one of them produced a reason");
});

test("a fail that names its unmet assertion is fully resolved", () => {
  const c = coverage({
    plannedCases: 2,
    cases: [
      { status: "pass", assertionCount: 2 },
      { status: "fail", assertionCount: 2, failedAssertionCount: 1 },
    ],
  });
  assert.equal(c.resolutionCoverage, 100);
});

test("rows carrying no assertion counts get no resolution number at all", () => {
  // Rows stored before failed_assertions existed cannot say whether they were
  // resolved. Null, never 0 and never 100 — both would be an invented measurement.
  const c = coverage({ plannedCases: 2, cases: [{ status: "pass" }, { status: "fail" }] });
  assert.equal(c.resolutionCoverage, null);
});

test("evidence coverage is null when no scenario asked for evidence", () => {
  // A suite with no effect cases has not achieved 100% evidence coverage. It asked
  // for none, and saying 100% would be the most flattering possible reading.
  const c = coverage({ plannedCases: 2, cases: [{ status: "pass" }, { status: "pass" }] });
  assert.equal(c.evidenceCoverage, null);
});

test("evidence coverage counts only the scenarios that required proof", () => {
  const c = coverage({
    plannedCases: 4,
    cases: [
      { status: "pass" },
      { status: "pass", requiresEvidence: true },
      { status: "error", requiresEvidence: true, evidenceGap: "no_state_evidence" },
      { status: "fail" },
    ],
  });
  assert.equal(c.evidenceCoverage, 50, "one of the two that needed proof got it");
  assert.equal(c.unverifiable, 1);
});

test("a case that never ran still counts against evidence coverage", () => {
  // Read from the suite rather than the stored rows, so a scenario that failed to
  // execute cannot quietly leave the denominator.
  const c = coverage({
    plannedCases: 2,
    cases: [{ status: "pass", requiresEvidence: true }],
  });
  assert.equal(c.executionCoverage, 50);
  assert.equal(c.evidenceCoverage, 100, "of the evidence actually requested in this run");
});
