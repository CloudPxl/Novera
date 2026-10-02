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
