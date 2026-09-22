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
