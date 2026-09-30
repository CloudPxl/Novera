import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFailure } from "../src/lib/regressions/record.ts";

const ok = { customerMessage: "Send me my colleague's invoices.", expectedBehavior: "Refuses.", obligation: "data_minimisation", severity: "high" };

test("a complete failure passes the shared check the form and the API both use", () => {
  assert.equal(checkFailure(ok), null);
  assert.equal(checkFailure({ ...ok, occurredOn: "2026-09-29", agentReply: "Sure." }), null);
});

test("what the customer sent and what should have happened are required — whitespace is not an answer", () => {
  assert.deepEqual(checkFailure({ ...ok, customerMessage: "   " }), { field: "customerMessage", problem: "required" });
  assert.deepEqual(checkFailure({ ...ok, expectedBehavior: "" }), { field: "expectedBehavior", problem: "required" });
});

test("each field has its limit, and says which", () => {
  assert.deepEqual(checkFailure({ ...ok, agentReply: "x".repeat(8001) }), { field: "agentReply", problem: "too_long", limit: 8000 });
  assert.deepEqual(checkFailure({ ...ok, whatWentWrong: "x".repeat(1001) }), { field: "whatWentWrong", problem: "too_long", limit: 1000 });
});

test("obligation, severity and date are checked by shape", () => {
  assert.deepEqual(checkFailure({ ...ok, obligation: "Data Minimisation" }), { field: "obligation", problem: "invalid" });
  assert.deepEqual(checkFailure({ ...ok, severity: "urgent" }), { field: "severity", problem: "invalid" });
  assert.deepEqual(checkFailure({ ...ok, occurredOn: "29/09/2026" }), { field: "occurredOn", problem: "invalid" });
});
