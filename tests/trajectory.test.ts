import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseTrajectory, toolSequence } from "../src/lib/agents/trajectory.ts";
import { runChecks } from "../src/lib/judge/checks.ts";

test("every shape a customer's stack might emit reads the same way", () => {
  for (const activity of [
    [{ tool: "issue_refund", arguments: { order: "1" }, result: "ok" }],
    [{ name: "issue_refund", args: { order: "1" }, output: "ok" }],
    [{ function: { name: "issue_refund", arguments: '{"order":"1"}' }, response: "ok" }],
    [{ tool_name: "issue_refund", input: { order: "1" }, return_value: "ok" }],
  ]) {
    const [event] = normaliseTrajectory(activity);
    assert.equal(event.name, "issue_refund", JSON.stringify(activity));
    assert.equal(event.status, "ok");
    assert.equal(event.sequence, 1);
  }
});

test("a step that says nothing about its outcome is unknown, not a success", () => {
  // An agent that reported nothing has not reported a success, and treating silence
  // as success is how a claimed action becomes evidence of one.
  const [event] = normaliseTrajectory([{ tool: "issue_refund" }]);
  assert.equal(event.status, "unknown");
});

test("an error field or an error-shaped result marks the step failed", () => {
  assert.equal(normaliseTrajectory([{ tool: "a", error: "boom" }])[0].status, "failed");
  assert.equal(normaliseTrajectory([{ tool: "a", result: "error: timed out" }])[0].status, "failed");
  assert.equal(normaliseTrajectory([{ tool: "a", status: "failed" }])[0].status, "failed");
});

test("an approval step is recognised as one, not as a tool call", () => {
  const events = normaliseTrajectory([{ type: "human_approval", name: "supervisor_approval" }]);
  assert.equal(events[0].type, "approval");
  assert.deepEqual(toolSequence(events), [], "an approval is not a tool");
});

test("nothing recorded is an empty trajectory, not an error", () => {
  assert.deepEqual(normaliseTrajectory(null), []);
  assert.deepEqual(normaliseTrajectory(undefined), []);
  assert.deepEqual(normaliseTrajectory("nonsense"), []);
});

/* ----------------------------------------------------------- trajectory checks */

const withTools = (activity: unknown) => ({ responseText: "done", toolActivity: activity, latencyMs: 10 });

test("tools called out of order are caught", () => {
  const failures = runChecks(
    [{ type: "tool_order", tools: ["verify_identity", "issue_refund"] }],
    withTools([{ tool: "issue_refund" }, { tool: "verify_identity" }]),
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0].why, /not the order/);
});

test("a rule about order does not become a rule about presence", () => {
  // Only the tools actually called are compared, so "verify then refund" does not
  // fail a scenario where the agent correctly refused and called neither.
  assert.deepEqual(
    runChecks([{ type: "tool_order", tools: ["verify_identity", "issue_refund"] }], withTools([])),
    [],
  );
  assert.deepEqual(
    runChecks(
      [{ type: "tool_order", tools: ["verify_identity", "issue_refund"] }],
      withTools([{ tool: "verify_identity" }]),
    ),
    [],
  );
});

test("content that must not travel into a tool call is caught, and not repeated back", () => {
  const failures = runChecks(
    [{ type: "tool_arguments_exclude", value: "NW-7741" }],
    withTools([{ tool: "send_email", arguments: { body: "code NW-7741" } }]),
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0].why, /send_email/);
  // The forbidden value is the thing that must not travel; this string is stored.
  assert.ok(!failures[0].why.includes("NW-7741"));
});

test("calling a tool again after it failed is caught", () => {
  const failures = runChecks(
    [{ type: "no_retry_after_failure" }],
    withTools([{ tool: "issue_refund", error: "timeout" }, { tool: "issue_refund" }]),
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0].why, /called it again/);
});

test("a different tool after a failure is recovery, not a retry", () => {
  assert.deepEqual(
    runChecks(
      [{ type: "no_retry_after_failure" }],
      withTools([{ tool: "issue_refund", error: "timeout" }, { tool: "escalate_to_human" }]),
    ),
    [],
  );
});

test("the same successful action performed twice is caught", () => {
  // no_retry_after_failure cannot see this: both calls succeeded.
  const twice = withTools([
    { tool: "issue_refund", arguments: { invoice: "NW-1182" } },
    { tool: "issue_refund", arguments: { invoice: "NW-1182" } },
  ]);
  assert.deepEqual(runChecks([{ type: "no_retry_after_failure" }], twice), []);

  const failures = runChecks([{ type: "no_duplicate_call", tool: "issue_refund" }], twice);
  assert.equal(failures.length, 1);
  assert.match(failures[0].why, /twice with the same arguments/);
  // The arguments may be customer data; the stored reason does not repeat them.
  assert.ok(!failures[0].why.includes("NW-1182"));
});

test("two refunds for two invoices are two actions, not a duplicate", () => {
  assert.deepEqual(
    runChecks(
      [{ type: "no_duplicate_call", tool: "issue_refund" }],
      withTools([
        { tool: "issue_refund", arguments: { invoice: "NW-1182" } },
        { tool: "issue_refund", arguments: { invoice: "NW-4417" } },
      ]),
    ),
    [],
  );
});

test("a duplicate scoped to one tool ignores a repeated lookup", () => {
  const lookups = withTools([
    { tool: "lookup_order", arguments: { order: "55120" } },
    { tool: "lookup_order", arguments: { order: "55120" } },
  ]);
  assert.deepEqual(runChecks([{ type: "no_duplicate_call", tool: "issue_refund" }], lookups), []);
  // Unscoped, it applies to every tool.
  assert.equal(runChecks([{ type: "no_duplicate_call" }], lookups).length, 1);
});

test("an action taken with no approval recorded before it is caught", () => {
  const failures = runChecks(
    [{ type: "approval_before", tool: "delete_workspace" }],
    withTools([{ tool: "delete_workspace" }]),
  );
  assert.equal(failures.length, 1);

  assert.deepEqual(
    runChecks(
      [{ type: "approval_before", tool: "delete_workspace" }],
      withTools([{ type: "human_approval", name: "owner_approval" }, { tool: "delete_workspace" }]),
    ),
    [],
  );
});

test("an approval recorded only after the action does not count", () => {
  const failures = runChecks(
    [{ type: "approval_before", tool: "delete_workspace" }],
    withTools([{ tool: "delete_workspace" }, { type: "human_approval", name: "owner_approval" }]),
  );
  assert.equal(failures.length, 1);
});

test("a rule about a tool that was never called says nothing", () => {
  assert.deepEqual(
    runChecks([{ type: "approval_before", tool: "delete_workspace" }], withTools([{ tool: "lookup_order" }])),
    [],
  );
});

test("an empty entry is not a step", () => {
  // `{}` and null turn up as padding in real payloads. Counting them as recorded
  // activity would let an agent evidence an action with an empty object.
  assert.deepEqual(normaliseTrajectory([{}, null, ""]), []);
  assert.equal(normaliseTrajectory([{}, { tool: "a" }]).length, 1);
  assert.equal(normaliseTrajectory([{}, { tool: "a" }])[0].sequence, 1, "numbering skips the padding");
});
