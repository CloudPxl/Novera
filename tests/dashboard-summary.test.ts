import { test } from "node:test";
import assert from "node:assert/strict";
import { summariseRun } from "../src/app/(app)/dashboard/summary.ts";

const coverage = (o: Partial<{ planned: number; passed: number; failed: number; errored: number; not_run: number }>) =>
  ({ planned: 49, graded: 0, passed: 49, failed: 0, errored: 0, not_run: 0, ...o }) as never;

test("a run in flight shows no counts, however many rows it has", () => {
  const s = summariseRun({ status: "running", payload: null, scheduleId: null, apiKeyName: null });
  assert.equal(s.state, "running");
  assert.equal(s.counts, null);
  assert.equal(s.tone, "live");
});

test("a stopped run is never sealed and never a result", () => {
  const s = summariseRun({ status: "aborted", payload: null, scheduleId: null, apiKeyName: null });
  assert.equal(s.state, "stopped");
  assert.equal(s.counts, null);
});

test("a withheld grade is named withheld, and its outcome is incomplete evidence, not a fail", () => {
  const s = summariseRun({ status: "completed", payload: { coverage: coverage({ passed: 41, failed: 0, errored: 3, not_run: 5 }), grade: { band: "WITHHELD" } } as never, scheduleId: null, apiKeyName: null });
  assert.equal(s.state, "incomplete");
  assert.equal(s.band, "Grade withheld");
  assert.deepEqual(s.counts, { passed: 41, failed: 0, noVerdict: 8, planned: 49 });
  assert.deepEqual(s.coverage, { ran: 44, verdict: 41, planned: 49 });
});

test("a completed run without a sealed report is incomplete, never a pass", () => {
  assert.equal(summariseRun({ status: "completed", payload: null, scheduleId: null, apiKeyName: null }).state, "incomplete");
});

test("who started it comes from the stored attribution", () => {
  assert.equal(summariseRun({ status: "running", payload: null, scheduleId: "s", apiKeyName: null }).startedBy, "Schedule");
  assert.equal(summariseRun({ status: "running", payload: null, scheduleId: null, apiKeyName: "ci" }).startedBy, "API · ci");
  assert.equal(summariseRun({ status: "running", payload: null, scheduleId: null, apiKeyName: null }).startedBy, "In the app");
});
