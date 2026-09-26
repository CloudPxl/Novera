import { test } from "node:test";
import assert from "node:assert/strict";
import { runChecks, describeFailures } from "../src/lib/judge/checks.ts";

const input = (over: Partial<Parameters<typeof runChecks>[1]> = {}) => ({
  responseText: "I've applied the discount and called the tool.",
  toolActivity: [{ tool: "issue_refund", arguments: {} }],
  latencyMs: 1200,
  ...over,
});

test("no checks means nothing is settled here", () => {
  assert.deepEqual(runChecks(undefined, input()), []);
  assert.deepEqual(runChecks([], input()), []);
});

test("a forbidden phrase is caught without asking a model", () => {
  const failures = runChecks([{ type: "must_not_contain", value: "DISCOUNT" }], input());
  assert.equal(failures.length, 1);
  // Case-insensitive, because a reader does not care and neither does the rule.
  assert.match(failures[0].why, /contains "DISCOUNT"/);
});

test("a required phrase that is absent fails", () => {
  const failures = runChecks([{ type: "must_contain", value: "invoice NW-4417" }], input());
  assert.equal(failures.length, 1);
});

test("a tool outside the permitted set is named", () => {
  const failures = runChecks([{ type: "tools_allowed", tools: ["lookup_order"] }], input());
  assert.match(failures[0].why, /issue_refund/);
});

test("a required tool that was never called fails", () => {
  const failures = runChecks([{ type: "tool_required", tool: "record_optout" }], input());
  assert.equal(failures.length, 1);
  assert.deepEqual(runChecks([{ type: "tool_required", tool: "issue_refund" }], input()), []);
});

test("tool names are read from whichever shape the adapter recorded", () => {
  for (const activity of [
    [{ name: "issue_refund" }],
    [{ function: "issue_refund" }],
    [{ tool_name: "issue_refund" }],
    ["issue_refund"],
    { tool: "issue_refund" },
  ]) {
    assert.deepEqual(
      runChecks([{ type: "tool_forbidden", tool: "issue_refund" }], input({ toolActivity: activity })).length,
      1,
      JSON.stringify(activity),
    );
  }
});

test("an unknown latency is not a slow answer", () => {
  assert.deepEqual(runChecks([{ type: "max_latency_ms", value: 500 }], input({ latencyMs: null })), []);
  assert.equal(runChecks([{ type: "max_latency_ms", value: 500 }], input()).length, 1);
});

test("an invalid pattern fails the check instead of throwing", () => {
  // A suite file is untrusted input; one malformed scenario must not take down a run.
  const failures = runChecks([{ type: "must_match", pattern: "([unclosed" }], input());
  assert.equal(failures.length, 1);
  assert.match(failures[0].why, /not valid/);
});

test("every failing rule is reported, not just the first", () => {
  const failures = runChecks(
    [
      { type: "must_not_contain", value: "discount" },
      { type: "tool_forbidden", tool: "issue_refund" },
      { type: "must_contain", value: "never appears" },
    ],
    input(),
  );
  assert.equal(failures.length, 3);
  assert.equal(describeFailures(failures).split(". ").length >= 3, true);
});

test("every rule has a plain description for the person approving it", async () => {
  const { describeCheck } = await import("../src/lib/judge/checks.ts");
  assert.equal(describeCheck({ type: "must_not_contain", value: "As an AI" }), "The reply does not contain “As an AI” (any case).");
  assert.equal(describeCheck({ type: "no_duplicate_call" }), "No call is repeated with the same arguments.");
  assert.match(describeCheck({ type: "tool_order", tools: ["lookup", "refund"] }), /lookup → refund/);
});
