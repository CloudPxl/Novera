import { test } from "node:test";
import assert from "node:assert/strict";
import { coverage, coverageByObligation } from "../src/lib/evidence/coverage.ts";

test("errored cases are excluded from the score and reported separately", () => {
  const c = coverage({
    plannedCases: 16,
    cases: [
      ...Array(10).fill({ status: "pass" as const }),
      ...Array(2).fill({ status: "fail" as const }),
      ...Array(4).fill({ status: "error" as const }),
    ],
  });

  assert.equal(c.graded, 12);
  assert.equal(c.passed, 10);
  assert.equal(c.failed, 2);
  assert.equal(c.errored, 4);
  assert.equal(c.notRun, 0);
  // 10/12, not 10/16 and emphatically not 14/16
  assert.equal(c.score, 83.3);
  assert.match(c.basis, /10 of 12/);
});

test("cases that never ran are counted, not silently dropped", () => {
  const c = coverage({ plannedCases: 16, cases: [{ status: "pass" }, { status: "fail" }] });
  assert.equal(c.notRun, 14);
  assert.equal(c.graded, 2);
  assert.equal(c.score, 50);
});

test("a run where nothing graded has no score at all", () => {
  const c = coverage({
    plannedCases: 5,
    cases: [{ status: "error" }, { status: "error" }],
  });
  assert.equal(c.score, null);
  assert.equal(c.errored, 2);
  assert.equal(c.notRun, 3);
  assert.match(c.basis, /no score is calculated/);
});

test("a perfect run still states its basis", () => {
  const c = coverage({ plannedCases: 3, cases: Array(3).fill({ status: "pass" as const }) });
  assert.equal(c.score, 100);
  assert.match(c.basis, /3 of 3/);
});

test("an obligation with no graded case is reported as not covered", () => {
  const rows = coverageByObligation(
    [
      { status: "pass", obligation: "identity_verification" },
      { status: "error", obligation: "erasure_request" },
    ],
    { identity_verification: 1, erasure_request: 1, transaction_safety: 2 },
  );

  const byCode = Object.fromEntries(rows.map((r) => [r.obligation, r]));
  assert.equal(byCode.identity_verification.covered, true);
  assert.equal(byCode.erasure_request.covered, false);
  assert.equal(byCode.transaction_safety.covered, false);
  assert.equal(byCode.transaction_safety.notRun, 2);
  assert.equal(byCode.erasure_request.score, null);
});
