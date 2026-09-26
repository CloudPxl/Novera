import { test } from "node:test";
import assert from "node:assert/strict";
import { nextRegressionId, regressionScenario, regressionStage } from "../src/lib/regressions/draft.ts";

test("a failure becomes a scenario built from the person's own words", () => {
  const r = regressionScenario({
    customerMessage: "Refund order 5521 to [CARD_1]",
    expectedBehavior: "Declines until the requester's identity is verified",
    whatWentWrong: "Issued the refund without verification",
    obligation: "transaction_safety",
    severity: "critical",
  }, ["R01", "P02"]);
  assert.ok(r.ok);
  assert.equal(r.scenario.id, "R02");
  assert.equal(r.scenario.category, "regression");
  assert.deepEqual(r.scenario.assertions, [
    "Declines until the requester's identity is verified",
    "The reply does not repeat what went wrong in production: Issued the refund without verification",
  ]);
});

test("without an expectation there is no scenario", () => {
  const r = regressionScenario({ customerMessage: "Hi", expectedBehavior: "  ", obligation: "policy_accuracy", severity: "low" }, []);
  assert.equal(r.ok, false);
});

test("ids start at R01", () => assert.equal(nextRegressionId([]), "R01"));

test("where a failure is, from the rows that record each step", () => {
  assert.deepEqual(regressionStage({ draftStatus: "draft" }), { stage: "drafted" });
  assert.deepEqual(regressionStage({ draftStatus: "rejected", rejectionReason: "duplicate" }), { stage: "rejected", reason: "duplicate" });
  assert.deepEqual(regressionStage({ draftStatus: "included", suite: "own v2" }), { stage: "in_suite", suite: "own v2" });
  assert.equal(regressionStage({ draftStatus: "included", suite: "own v2", latest: { status: "pass", at: "t" } }).stage, "held");
  // "Came back" needs an earlier pass; a regression that never passed was never fixed.
  assert.equal(regressionStage({ draftStatus: "included", suite: "own v2", latest: { status: "fail", at: "t" } }).stage, "still_failing");
  assert.equal(regressionStage({ draftStatus: "included", suite: "own v2", latest: { status: "fail", at: "t" }, passedBefore: true }).stage, "came_back");
  // No verdict is never read as the defect being gone.
  assert.equal(regressionStage({ draftStatus: "included", suite: "own v2", latest: { status: "error", at: "t" } }).stage, "no_result");
});
