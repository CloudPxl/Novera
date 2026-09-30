import { test } from "node:test";
import assert from "node:assert/strict";
import { rulesLine } from "../src/app/(app)/runs/[id]/chain.ts";

test("a case that went on to the read-back or the models had every rule hold", () => {
  assert.equal(rulesLine({ ruleCount: 3, status: "pass", settledBy: "models" }), "3 rules checked; none was broken.");
  assert.equal(rulesLine({ ruleCount: 1, status: "fail", settledBy: "read_back" }), "1 rule checked; none was broken.");
});

test("no result, or a row from before rules existed, is not evidence that the rules held", () => {
  assert.equal(rulesLine({ ruleCount: 2, status: "error", settledBy: "models" }), "2 rules; no rule finding was recorded.");
  assert.equal(rulesLine({ ruleCount: 2, status: "fail", settledBy: null }), "2 rules; no rule finding was recorded.");
});

test("a scenario with no rules says so", () => {
  assert.equal(rulesLine({ ruleCount: 0, status: "pass", settledBy: "models" }), "This scenario has no rules of its own.");
});
