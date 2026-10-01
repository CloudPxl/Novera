import { test } from "node:test";
import assert from "node:assert/strict";
import { pipelineOutcome } from "../src/lib/report/outcome.ts";
import { ciOutcome } from "../src/lib/report/ci.ts";

type Band = "A" | "B" | "C" | "F" | "INCOMPLETE" | "WITHHELD" | undefined;
const payload = (c: { planned: number; passed: number; failed: number; errored: number; not_run: number }, band: Band) =>
  ({ coverage: c, grade: band ? { band } : undefined }) as never;

// Every combination of up to three planned scenarios, every band, every run status.
const combos: Array<{ c: { planned: number; passed: number; failed: number; errored: number; not_run: number }; band: Band; status: string }> = [];
for (let planned = 0; planned <= 3; planned++)
  for (let passed = 0; passed <= 3; passed++)
    for (let failed = 0; failed <= 3; failed++)
      for (let errored = 0; errored <= 3; errored++)
        for (let not_run = 0; not_run <= 3; not_run++) {
          if (passed + failed + errored + not_run > planned) continue;
          for (const band of ["A", "B", "C", "F", "INCOMPLETE", "WITHHELD", undefined] as Band[])
            for (const status of ["completed", "aborted", "running", "queued"])
              combos.push({ c: { planned, passed, failed, errored, not_run }, band, status });
        }

test("a pipeline is told 'pass' only when every planned scenario ran, produced a verdict and passed, and the report is complete", () => {
  for (const { c, band, status } of combos) {
    if (pipelineOutcome({ status }, payload(c, band)) !== "pass") continue;
    const where = JSON.stringify({ c, band, status });
    assert.equal(status, "completed", where);
    assert.ok(c.planned > 0, where);
    assert.equal(c.failed, 0, where);
    assert.equal(c.errored, 0, where);
    assert.equal(c.not_run, 0, where);
    assert.equal(c.passed, c.planned, `a planned scenario with no result is never a pass: ${where}`);
    assert.ok(band !== "INCOMPLETE" && band !== "WITHHELD", where);
  }
});

test("errored, not run, missing, withheld and incomplete are never a pass; a failure is a failure", () => {
  for (const { c, band, status } of combos) {
    const outcome = pipelineOutcome({ status }, payload(c, band));
    const where = JSON.stringify({ c, band, status });
    if (c.errored > 0 || c.not_run > 0 || c.passed + c.failed < c.planned || band === "WITHHELD" || band === "INCOMPLETE") {
      assert.notEqual(outcome, "pass", where);
    }
    if (status === "completed" && c.failed > 0) assert.equal(outcome, "fail", where);
  }
});

test("a run that did not complete, or has no report, is incomplete whatever its rows say", () => {
  const clean = { planned: 2, passed: 2, failed: 0, errored: 0, not_run: 0 };
  for (const status of ["aborted", "running", "queued"]) assert.equal(pipelineOutcome({ status }, payload(clean, "A")), "incomplete", status);
  assert.equal(pipelineOutcome({ status: "completed" }, null), "incomplete");
  assert.equal(pipelineOutcome({ status: "completed" }, { format: 12 } as never), "incomplete", "a payload without coverage is not evidence of a pass");
});

test("the webhook and the CLI decide the same way over the same report", () => {
  for (const { c, band } of combos) {
    const p = payload(c, band);
    const expected = ["pass", "fail", "incomplete"][ciOutcome(p).code];
    assert.equal(pipelineOutcome({ status: "completed" }, p), expected, JSON.stringify({ c, band }));
  }
});

test("a webhook says why a run ended in one of three fixed sentences, never the run's own words (R7)", async () => {
  const { abortedReason } = await import("../src/lib/webhooks/deliver.ts");
  const stopped = abortedReason({ error: "Stopped by someone@example.test before it finished.", stopped_by: "u1" });
  assert.equal(stopped, "Stopped by a member of the workspace before it finished.");
  assert.equal(abortedReason({ error: "Stopped: no scenario was graded for 24 hours, so this run cannot finish as one sitting.", stopped_by: null }), "Stopped because no scenario was graded for 24 hours.");
  const failed = abortedReason({ error: "Could not save case T01: duplicate key value violates unique constraint run_cases_run_id_case_id_key", stopped_by: null });
  assert.doesNotMatch(failed, /duplicate key|run_cases/);
});
