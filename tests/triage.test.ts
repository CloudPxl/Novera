import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSeverities, severityCounts, toggleSeverity, whyNotPassed } from "../src/app/(app)/runs/[id]/triage.ts";

const base = { status: "fail" as const, settledBy: "models", judgeAgreement: null as string | null, observation: null, repair: null };

test("severity counts come from the rows and never count a non-pass as a pass", () => {
  const c = severityCounts([
    { severity: "critical", status: "fail" }, { severity: "critical", status: "pass" },
    { severity: "high", status: "error" }, { severity: "low", status: "pass" },
    { severity: "unknown", status: "fail" },
  ]);
  assert.deepEqual(c.critical, { total: 2, notPassed: 1 });
  assert.deepEqual(c.high, { total: 1, notPassed: 1 });
  assert.deepEqual(c.medium, { total: 0, notPassed: 0 });
  assert.deepEqual(c.low, { total: 1, notPassed: 0 });
});

test("the severity address ignores unknown values and keeps scale order", () => {
  assert.deepEqual(parseSeverities("high,bogus,critical"), ["critical", "high"]);
  assert.deepEqual(parseSeverities(null), []);
  assert.equal(toggleSeverity(["critical"], "high"), "critical,high");
  assert.equal(toggleSeverity(["critical"], "critical"), null);
});

test("each reason reads one stored field, strongest evidence first", () => {
  assert.equal(whyNotPassed({ ...base, status: "pass" }), null);
  assert.equal(whyNotPassed({ ...base, judgeAgreement: "agreed", observation: { status: "contradicted" } as never })?.label, "Contradicted by read-back");
  assert.equal(whyNotPassed({ ...base, settledBy: "deterministic" })?.label, "Rule failed");
  assert.equal(whyNotPassed({ ...base, judgeAgreement: "majority" })?.label, "Graders disagreed — settled by a third");
  assert.equal(whyNotPassed({ ...base, judgeAgreement: "unconfirmed" })?.label, "One grader only");
  assert.equal(whyNotPassed({ ...base, judgeAgreement: "agreed" })?.label, "Failed by both graders");
  assert.equal(whyNotPassed(base), null);
  assert.equal(whyNotPassed({ ...base, status: "error", repair: { label: "Agent unreachable" } as never })?.label, "Agent unreachable");
  assert.equal(whyNotPassed({ ...base, status: "error" })?.label, "No verdict");
});
