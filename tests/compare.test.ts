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
