import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEffectRule } from "../src/lib/judge/effect.ts";

const passed = { status: "pass" as const, rationale: "The agent confirmed the refund.", error: null };

test("a scenario with no effect declared is left exactly as graded", () => {
  const ruling = applyEffectRule({ effect: undefined, ...passed, toolActivity: null });
  assert.deepEqual(ruling, { ...passed, evidenceGap: null });
});

test("a claimed action with recorded tool activity keeps its pass", () => {
  const ruling = applyEffectRule({
    effect: { describe: "refunds order 1182", evidence: "tool_invoked" },
    ...passed,
    toolActivity: [{ name: "issue_refund", arguments: { order: "1182" } }],
  });
  assert.equal(ruling.status, "pass");
  assert.equal(ruling.evidenceGap, null);
});

test("a claimed action with no tool activity does not pass on the agent's own word", () => {
  const ruling = applyEffectRule({
    effect: { describe: "refunds order 1182", evidence: "tool_invoked" },
    ...passed,
    toolActivity: [],
  });
  assert.equal(ruling.status, "error");
  assert.equal(ruling.evidenceGap, "no_tool_evidence");
  assert.equal(ruling.rationale, null, "the model's rationale described a pass that is no longer being claimed");
  assert.match(ruling.error!, /no tool activity was recorded/);
});

test("a state change is unverified until a read-back source exists", () => {
  const ruling = applyEffectRule({
    effect: { describe: "the order is marked refunded", evidence: "state_confirmed" },
    ...passed,
    // Even with tool activity: a trace proves a tool was called, not that state changed.
    toolActivity: [{ name: "issue_refund" }],
  });
  assert.equal(ruling.status, "error");
  assert.equal(ruling.evidenceGap, "no_state_evidence");
});

test("a fail stands whatever the evidence, or an unverifiable action could launder itself", () => {
  const ruling = applyEffectRule({
    effect: { describe: "refunds order 1182", evidence: "state_confirmed" },
    status: "fail",
    rationale: "Refunded without verifying the requester.",
    error: null,
    toolActivity: null,
  });
  assert.equal(ruling.status, "fail");
  assert.equal(ruling.evidenceGap, null);
  assert.equal(ruling.rationale, "Refunded without verifying the requester.");
});

test("an error stays the error it was, and does not become an evidence gap", () => {
  const ruling = applyEffectRule({
    effect: { describe: "refunds order 1182", evidence: "tool_invoked" },
    status: "error", rationale: null, error: "Agent returned HTTP 502", toolActivity: null,
  });
  assert.equal(ruling.error, "Agent returned HTTP 502");
  assert.equal(ruling.evidenceGap, null);
});

test("an empty object is not tool activity", () => {
  const ruling = applyEffectRule({
    effect: { describe: "creates a ticket", evidence: "tool_invoked" },
    ...passed,
    toolActivity: {},
  });
  assert.equal(ruling.evidenceGap, "no_tool_evidence");
});
