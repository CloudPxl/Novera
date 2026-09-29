import { test } from "node:test";
import assert from "node:assert/strict";
import { LENSES } from "../src/app/(app)/runs/[id]/lenses.ts";
import type { CaseRow } from "../src/app/(app)/runs/[id]/case-table.tsx";

/**
 * A filter that quietly includes or drops the wrong scenario is worse than no filter:
 * a reviewer who selects "no evidence" and sees four cases believes they have seen
 * every one. So each lens is pinned to the stored field it reads, and nothing else.
 */

const base: CaseRow = {
  id: "1", caseId: "T01", category: "policy", categoryLabel: "Policy",
  obligation: "policy_accuracy", obligationLabel: "Policy accuracy", severity: "medium",
  status: "pass", input: "hello", expected: "something", assertions: ["a"],
  failedAssertions: [], responseText: "hi", rationale: null, error: null,
  judgeModel: "groq/x", judgeAgreement: "agreed", judgeVotes: [],
  evidenceGap: null, trajectory: [], observation: null, latencyMs: 10, dutyRefs: [], instability: null,
};

const lens = (key: string) => {
  const found = LENSES.find((l) => l.key === key);
  if (!found) throw new Error(`no lens named ${key}`);
  return found;
};

test("the evidence lens selects exactly the cases with a recorded gap", () => {
  assert.equal(lens("evidence").match({ ...base, evidenceGap: "no_tool_evidence" }), true);
  assert.equal(lens("evidence").match({ ...base, status: "fail" }), false);
  // A failure is not an evidence gap. Folding them together would hide the
  // distinction the whole evidence model exists to make.
  assert.equal(lens("evidence").match({ ...base, status: "error", error: "timeout" }), false);
});

test("the action lens covers both what was verified and what could not be", () => {
  const confirmed = {
    ...base,
    observation: {
      status: "confirmed" as const, detail: "d", connector: "http_read",
      connectorVersion: "1", mode: "read_only", latencyMs: 5,
    },
  };
  assert.equal(lens("action").match(confirmed), true);
  assert.equal(lens("action").match({ ...base, evidenceGap: "read_back_unavailable" }), true);
  assert.equal(lens("action").match(base), false);
});

test("contradicted means the customer's own system disagreed, not that a case failed", () => {
  const contradicted = {
    ...base,
    status: "fail" as const,
    observation: {
      status: "contradicted" as const, detail: "still open", connector: "http_read",
      connectorVersion: "1", mode: "read_only", latencyMs: 5,
    },
  };
  assert.equal(lens("contradicted").match(contradicted), true);
  assert.equal(lens("contradicted").match({ ...base, status: "fail" }), false);
});

test("judges disagreed selects only verdicts that were never settled", () => {
  assert.equal(lens("disagreed").match({ ...base, judgeAgreement: "unresolved" }), true);
  assert.equal(lens("disagreed").match({ ...base, judgeAgreement: "disputed" }), true);
  // A third model settling a disagreement is the system working, not a finding.
  assert.equal(lens("disagreed").match({ ...base, judgeAgreement: "majority" }), false);
  assert.equal(lens("disagreed").match(base), false);
});

test("privacy and security only ever selects scenarios that did not pass", () => {
  assert.equal(lens("sensitive").match({ ...base, category: "privacy", status: "fail" }), true);
  assert.equal(lens("sensitive").match({ ...base, category: "security", status: "error" }), true);
  assert.equal(lens("sensitive").match({ ...base, category: "privacy" }), false);
  assert.equal(lens("sensitive").match({ ...base, category: "policy", status: "fail" }), false);
});

test("needs a person is severity-led, and never includes a pass", () => {
  assert.equal(lens("review").match({ ...base, severity: "critical", status: "fail" }), true);
  assert.equal(lens("review").match({ ...base, severity: "high", status: "error" }), true);
  assert.equal(lens("review").match({ ...base, severity: "critical" }), false);
  assert.equal(lens("review").match({ ...base, severity: "low", status: "fail" }), false);
});

test("a regression is only ever what the comparison said, never inferred", () => {
  // The page derives this from the same comparison the ribbon renders. A second
  // notion of "newly broken" on one page is how a reviewer trusts the wrong one.
  assert.equal(lens("regression").match({ ...base, regression: true }), true);
  assert.equal(lens("regression").match({ ...base, status: "fail" }), false);
});

test("every lens has a hint that says what it selects", () => {
  for (const l of LENSES) {
    assert.ok(l.hint.length > 20, `${l.key} needs a hint a reviewer can act on`);
    assert.ok(l.label.length > 0);
  }
});

test("the rights lens covers GDPR Arts. 15–22 only, and only where the scenario did not pass", () => {
  const withRefs = (dutyRefs: string[], status: CaseRow["status"] = "fail") => ({ ...base, status, dutyRefs });
  for (const ref of ["GDPR Art. 15", "GDPR Art. 18", "GDPR Art. 19", "GDPR Art. 22"]) assert.equal(lens("rights").match(withRefs([ref])), true, ref);
  for (const ref of ["GDPR Art. 12(6)", "GDPR Art. 32", "GDPR Art. 5(1)(c)", "GDPR Art. 25", "EU AI Act Art. 15"]) assert.equal(lens("rights").match(withRefs([ref])), false, ref);
  assert.equal(lens("rights").match(withRefs(["GDPR Art. 17"], "pass")), false);
  assert.equal(lens("rights").match(withRefs(["GDPR Art. 17"], "error")), true, "no result is not a pass");
});

test("the transparency lens covers AI Act Arts. 13 and 50, and nothing near them", () => {
  const withRefs = (dutyRefs: string[]) => ({ ...base, status: "fail" as const, dutyRefs });
  assert.equal(lens("transparency").match(withRefs(["EU AI Act Art. 50(1)"])), true);
  assert.equal(lens("transparency").match(withRefs(["EU AI Act Art. 13"])), true);
  assert.equal(lens("transparency").match(withRefs(["EU AI Act Art. 14"])), false);
  assert.equal(lens("transparency").match(withRefs(["EU AI Act Art. 130"])), false);
});
