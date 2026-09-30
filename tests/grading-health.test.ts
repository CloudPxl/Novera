import { test } from "node:test";
import assert from "node:assert/strict";
import { describeVendor, gradingHealth } from "../src/lib/evidence/grading-health.ts";

const ok = (connection: string, ms: number) => ({ connection, model: "m", ok: true, ms });
const fail = (connection: string, reason?: string) => ({ connection, model: "m", ok: false, ms: 50, ...(reason ? { reason } : {}) });

test("requests are counted per vendor, from the stored attempts only", () => {
  const h = gradingHealth([
    { status: "pass", judge_attempts: [fail("groq", "rate_limited"), ok("mistral", 2100), ok("groq", 900)] },
    { status: "fail", judge_attempts: [ok("groq", 3140), ok("mistral", 1800)] },
    { status: "error", judge_attempts: [fail("groq", "timed_out"), fail("mistral", "provider_error")] },
  ]);
  const groq = h.vendors.find((v) => v.vendor === "groq")!;
  const mistral = h.vendors.find((v) => v.vendor === "mistral")!;
  assert.deepEqual(
    { sent: groq.sent, answered: groq.answered, rateLimited: groq.rateLimited, timedOut: groq.timedOut, slowestMs: groq.slowestMs },
    { sent: 4, answered: 2, rateLimited: 1, timedOut: 1, slowestMs: 3140 },
  );
  assert.deepEqual({ sent: mistral.sent, answered: mistral.answered, failed: mistral.failed }, { sent: 3, answered: 2, failed: 1 });
  // Only the pass absorbed a failure; the errored case lost its verdict, which is not absorbing it.
  assert.equal(h.absorbed, 1);
  assert.equal(h.vendors[0].vendor, "groq", "the busiest vendor first");
});

test("a candidate passed over without a request is not counted as a request", () => {
  const h = gradingHealth([{ status: "pass", judge_attempts: [
    fail("groq", "skipped_open_circuit"), fail("google", "refused_data_class"), fail("openai", "no_credential"), fail("groq", "out_of_time"), ok("mistral", 700),
  ] }]);
  const groq = h.vendors.find((v) => v.vendor === "groq")!;
  assert.equal(groq.sent, 0);
  assert.equal(groq.notSent, 2);
  // Nothing that was sent failed, so nothing was absorbed.
  assert.equal(h.absorbed, 0);
});

test("an answer without a readable verdict is sent and answered, but not answered with a verdict", () => {
  const h = gradingHealth([{ status: "pass", judge_attempts: [{ ...ok("groq", 1200), reason: "invalid_output" }, ok("mistral", 800)] }]);
  const groq = h.vendors.find((v) => v.vendor === "groq")!;
  assert.deepEqual({ sent: groq.sent, answered: groq.answered, unreadable: groq.unreadable, slowestMs: groq.slowestMs }, { sent: 1, answered: 0, unreadable: 1, slowestMs: 1200 });
  assert.equal(h.absorbed, 1);
});

test("a failure from before reasons were typed is counted as unclassified, never guessed from its text", () => {
  const h = gradingHealth([{ status: "pass", judge_attempts: [
    { connection: "groq", model: "m", ok: false, ms: 63, error: "Rate limit reached for model" }, ok("mistral", 2156),
  ] }]);
  const groq = h.vendors.find((v) => v.vendor === "groq")!;
  assert.equal(groq.rateLimited, 0);
  assert.equal(groq.failed, 1);
  assert.equal(h.unclassified, 1);
});

test("a rule-settled run has no grader requests, and malformed rows are ignored", () => {
  assert.deepEqual(gradingHealth([{ status: "fail", judge_attempts: [] }, { status: "pass", judge_attempts: null }, { status: "pass", judge_attempts: [null, { ok: true }] }]),
    { vendors: [], absorbed: 0, unclassified: 0 });
});

test("a vendor in words", () => {
  assert.equal(
    describeVendor({ vendor: "groq", sent: 40, answered: 32, unreadable: 0, rateLimited: 8, timedOut: 0, failed: 0, notSent: 3, slowestMs: 3140 }),
    "groq: 40 requests, 32 answered, 8 rate-limited, 3 not sent, slowest answer 3.1 s",
  );
  assert.equal(
    describeVendor({ vendor: "mistral", sent: 1, answered: 0, unreadable: 0, rateLimited: 0, timedOut: 1, failed: 0, notSent: 0, slowestMs: null }),
    "mistral: 1 request, 0 answered, 1 timed out",
  );
});
