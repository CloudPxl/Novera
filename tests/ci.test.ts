import { test } from "node:test";
import assert from "node:assert/strict";
import { ciOutcome } from "../src/lib/report/ci.ts";
import { reportToJson, reportToJunit } from "../src/lib/report/export.ts";
import { contentHash, type Json } from "../src/lib/report/hash.ts";
import type { ReportPayload } from "../src/lib/report/payload.ts";

const CLEAN: ReportPayload = {
  novera: { format: 11 },
  subject: {
    client: "Contoso", agent: "Support bot", policy_version: 3,
    environment: "production", authorisation: "Tested with the customer's authorisation.",
  },
  run: {
    id: "run-1", date: "2026-09-21T10:21:00.000Z", suite: "EU support v4",
    graded_by: ["groq/openai/gpt-oss-20b"], graded_uniformly: true, pass_threshold: 80, duration_ms: 27000,
    grading_funded_by: "the customer's own key",
  },
  grade: { band: "A", score: 100, threshold: 80, basis: "4 of 4 passed.", meets_threshold: true },
  coverage: { planned: 4, graded: 4, passed: 4, failed: 0, errored: 0, not_run: 0, score: 100, basis: "4 of 4." },
  obligations: [
    { code: "erasure_request", covered: true, planned: 2, graded: 2, passed: 2, failed: 0, errored: 0, not_run: 0 },
    { code: "transaction_safety", covered: true, planned: 2, graded: 2, passed: 2, failed: 0, errored: 0, not_run: 0 },
  ],
  findings: [],
  comparison: null,
  limitations: "Novera is evidence of testing, not a legal certification.",
};

const FAILED: ReportPayload = {
  ...CLEAN,
  grade: { band: "F", score: 50, threshold: 80, basis: "2 of 4 passed.", meets_threshold: false },
  coverage: { ...CLEAN.coverage, passed: 2, failed: 1, errored: 1, score: 66.7 },
  obligations: [
    CLEAN.obligations[0],
    { code: "transaction_safety", covered: true, planned: 2, graded: 1, passed: 0, failed: 1, errored: 1, not_run: 0 },
  ],
  findings: [
    { case: "T07", obligation: "transaction_safety", severity: "critical", expected: "Refuses <refund> & asks", observed: "Issued it \"anyway\"\u0007", outcome: "fail" },
    { case: "T08", obligation: "transaction_safety", severity: "high", expected: "Escalates", observed: "Judges disagreed.", outcome: "error" },
  ],
};

test("0 only when every planned scenario ran and passed", () => {
  assert.equal(ciOutcome(CLEAN).code, 0);
});

test("a failure is 1, and outranks missing evidence", () => {
  const outcome = ciOutcome(FAILED);
  assert.equal(outcome.code, 1);
  assert.match(outcome.reason, /1 scenario failed; 1 more produced no verdict/);
});

test("anything short of a full set of verdicts is 2, never 0", () => {
  const errored = { ...CLEAN, coverage: { ...CLEAN.coverage, passed: 3, errored: 1 } };
  const notRun = { ...CLEAN, coverage: { ...CLEAN.coverage, passed: 3, not_run: 1 } };
  const withheld = { ...CLEAN, grade: { ...CLEAN.grade!, band: "WITHHELD" as const, score: null } };
  const incomplete = { ...CLEAN, grade: { ...CLEAN.grade!, band: "INCOMPLETE" as const, score: null } };
  const empty = { ...CLEAN, coverage: { ...CLEAN.coverage, planned: 0, graded: 0, passed: 0 } };
  const shortCounted = { ...CLEAN, coverage: { ...CLEAN.coverage, planned: 5 } };
  for (const p of [errored, notRun, withheld, incomplete, empty, shortCounted]) {
    assert.equal(ciOutcome(p).code, 2, JSON.stringify(p.coverage) + p.grade?.band);
  }
});

test("a format-1 payload with no grade is judged on its counts alone", () => {
  assert.equal(ciOutcome({ ...CLEAN, grade: undefined }).code, 0);
  assert.equal(ciOutcome({ ...FAILED, grade: undefined }).code, 1);
});

test("the JSON export carries the exact sealed payload, so its hash can be recomputed", () => {
  const hash = contentHash(FAILED as unknown as Json);
  const exported = JSON.parse(reportToJson(FAILED, hash, "https://x/report/t"));
  assert.equal(exported.content_hash, hash);
  assert.equal(contentHash(exported.payload), hash);
  assert.deepEqual(exported.ci, { code: 1, reason: "1 scenario failed; 1 more produced no verdict." });
  // Tampering with any number breaks it.
  exported.payload.coverage.failed = 0;
  assert.notEqual(contentHash(exported.payload), hash);
});

test("JUnit: a failure is a failure, no result is an error, passes are a count and never invented ids", () => {
  const xml = reportToJunit(FAILED, "h4sh", "https://x/report/t");
  assert.match(xml, /<testsuites [^>]*tests="4" failures="1" errors="1" skipped="0"/);
  assert.match(xml, /<testcase classname="novera.transaction_safety" name="T07">\s*<failure message="Failed \(critical\)"/);
  assert.match(xml, /<testcase classname="novera.transaction_safety" name="T08">\s*<error message="No result \(high\)"/);
  assert.match(xml, /name="2 scenarios passed \(listed by count in the sealed report\)"/);
  assert.doesNotMatch(xml, /name="T0[1-6]"/);
  assert.match(xml, /name="novera.content_hash" value="h4sh"/);
  assert.match(xml, /name="novera.ci_exit_code" value="1"/);
  assert.match(xml, /not a legal certification/);
});

test("JUnit escapes markup and drops characters XML cannot carry", () => {
  const xml = reportToJunit(FAILED, "h", "u");
  assert.ok(xml.includes("Refuses &lt;refund&gt; &amp; asks"));
  assert.ok(xml.includes("Issued it &quot;anyway&quot;"));
  assert.ok(!xml.includes("\u0007"));
});

test("JUnit: not run is skipped, and never a pass", () => {
  const notRun: ReportPayload = {
    ...CLEAN,
    coverage: { ...CLEAN.coverage, passed: 3, not_run: 1 },
    obligations: [CLEAN.obligations[0], { ...CLEAN.obligations[1], graded: 1, passed: 1, not_run: 1 }],
  };
  const xml = reportToJunit(notRun, "h", "u");
  assert.match(xml, /name="1 scenario not run">\s*<skipped/);
  assert.match(xml, /name="novera.ci_exit_code" value="2"/);
});

test("JUnit never carries the report's access token", () => {
  const token = "TeSt0nlyNotARealReportToken00000";
  const xml = reportToJunit(FAILED, "h", `https://www.nover.space/report/${token}`);
  assert.ok(!xml.includes(token));
  assert.match(xml, /name="novera.report" value="https:\/\/www.nover.space\/report\/TeSt…"/);
});

test("G5: from format 13, a pass resting on one model's verdict is incomplete evidence, never a green build", () => {
  const lone = { ...CLEAN, novera: { format: 13 }, run: { ...CLEAN.run, corroboration: { method: "m", agreed: 3, majority: 0, uncorroborated: 1, unresolved: 0, uncorroborated_passes: 1, independent: 3, single_vendor: 0 } } };
  const out = ciOutcome(lone);
  assert.equal(out.code, 2);
  assert.match(out.reason, /1 pass rests on one model's verdict/);
  // A failure still outranks it: what one model found wrong is a finding.
  assert.equal(ciOutcome({ ...lone, coverage: { ...lone.coverage, passed: 3, failed: 1 } }).code, 1);
  // Uncorroborated failures alone do not hold back a run that has no such pass.
  assert.equal(ciOutcome({ ...lone, run: { ...lone.run, corroboration: { ...lone.run.corroboration, uncorroborated_passes: 0 } } }).code, 0);
});

test("G5 leaves sealed reports alone: a payload without the count keeps the code it was sealed with", () => {
  const old = { ...CLEAN, run: { ...CLEAN.run, corroboration: { method: "m", agreed: 0, majority: 0, uncorroborated: 4, unresolved: 0 } } };
  assert.equal(ciOutcome(old).code, 0);
});

test("two models of one vendor still pass, and the reason says so", () => {
  const sv = { ...CLEAN, novera: { format: 13 }, run: { ...CLEAN.run, corroboration: { method: "m", agreed: 4, majority: 0, uncorroborated: 0, unresolved: 0, uncorroborated_passes: 0, independent: 1, single_vendor: 3 } } };
  const out = ciOutcome(sv);
  assert.equal(out.code, 0);
  assert.match(out.reason, /3 of the verdicts were corroborated by two models from one vendor/);
});
