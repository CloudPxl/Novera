import { test } from "node:test";
import assert from "node:assert/strict";
import { reissueWithReview, NothingToDisclose, REVIEWED_BY } from "../src/lib/report/reissue.ts";
import { withFindingsApplied, latestReviews, type VerdictReview } from "../src/lib/evidence/reviews.ts";
import { reportToCsv, reportToMarkdown } from "../src/lib/report/export.ts";
import { contentHash, type Json } from "../src/lib/report/hash.ts";
import { LeakError } from "../src/lib/report/redact.ts";
import type { ReportPayload } from "../src/lib/report/payload.ts";

const ORIGINAL: ReportPayload = {
  novera: { format: 10 },
  subject: { client: "Contoso", agent: "Support bot", policy_version: 3, environment: "production", authorisation: "Recorded." },
  run: {
    id: "run-1", date: "2026-09-25", suite: "EU support (eu-support v4)",
    graded_by: ["groq/openai/gpt-oss-20b"], graded_uniformly: true, pass_threshold: 80,
    grading_funded_by: "the Novera trial allowance", previous_report_hash: "a".repeat(64),
  },
  grade: { band: "C", score: 66.7, threshold: 80, basis: "2 of 3 graded scenarios passed.", meets_threshold: false },
  coverage: { planned: 4, graded: 3, passed: 2, failed: 1, errored: 1, not_run: 0, score: 66.7, basis: "2 of 3." },
  obligations: [],
  findings: [],
  comparison: null,
  limitations: "Novera is evidence of testing, not a legal certification.",
};

const CASES = [
  { runCaseId: "c1", caseId: "T01", status: "pass" as const },
  { runCaseId: "c2", caseId: "T02", status: "pass" as const },
  { runCaseId: "c3", caseId: "T03", status: "fail" as const },
  { runCaseId: "c4", caseId: "T04", status: "error" as const },
];

const review = (runCaseId: string, verdictStatus: VerdictReview["verdictStatus"], finding: "pass" | "fail", createdAt: string, note = "The transcript shows the refund was routed correctly."): VerdictReview =>
  ({ id: `${runCaseId}-${createdAt}`, runCaseId, reviewerId: "u1", verdictStatus, finding, note, createdAt });

const REVIEWS = [
  review("c1", "pass", "pass", "2026-09-25T10:00:00Z"),
  review("c3", "fail", "pass", "2026-09-25T10:01:00Z"),
  review("c4", "error", "fail", "2026-09-25T10:02:00Z"),
  // A changed mind: the earlier finding on c2 is superseded by a later one.
  review("c2", "pass", "fail", "2026-09-25T10:03:00Z"),
  review("c2", "pass", "pass", "2026-09-25T10:04:00Z"),
];

const build = (overrides: Partial<Parameters<typeof reissueWithReview>[0]> = {}) =>
  reissueWithReview({
    original: ORIGINAL, originalHash: "b".repeat(64), previousReportHash: "c".repeat(64),
    cases: CASES, reviews: REVIEWS, asOf: "2026-09-25T11:00:00Z", privateMaterial: [], ...overrides,
  });

test("findings applied: the tested party's reading, counted from stored cases", () => {
  const applied = withFindingsApplied(CASES, latestReviews(REVIEWS));
  // c3 fail -> pass, c4 error -> fail; c2's latest finding agrees.
  assert.deepEqual(applied, { passed: 3, failed: 1, noVerdict: 0, changed: 2 });
});

test("a reissue carries every original section unchanged and never touches the score", () => {
  const { payload } = build();
  assert.deepEqual(payload.grade, ORIGINAL.grade);
  assert.deepEqual(payload.coverage, ORIGINAL.coverage);
  assert.deepEqual(payload.findings, ORIGINAL.findings);
  assert.deepEqual(payload.subject, ORIGINAL.subject);
  const { previous_report_hash: _p, ...runRest } = payload.run;
  const { previous_report_hash: _o, ...originalRunRest } = ORIGINAL.run;
  assert.deepEqual(runRest, originalRunRest);
  assert.equal(payload.run.previous_report_hash, "c".repeat(64));
  assert.equal(payload.novera.format, 11);
  assert.deepEqual(payload.reissue, { of: "b".repeat(64), reason: "human_review" });
});

test("the review lists disagreements and gap fills with reasons, and counts agreements only", () => {
  const review = build().payload.human_review!;
  assert.equal(review.reviewed_by, REVIEWED_BY);
  assert.deepEqual([review.reviewed, review.agreed, review.disagreed, review.resolved_gaps], [4, 2, 1, 1]);
  assert.deepEqual(review.findings.map((f) => f.case_id), ["T03", "T04"]);
  assert.deepEqual(review.with_findings_applied, { passed: 3, failed: 1, no_verdict: 0, changed: 2 });
});

test("the hash is over the reissued payload and verifies", () => {
  const { payload, contentHash: hash } = build();
  assert.equal(contentHash(payload as unknown as Json), hash);
  assert.notEqual(hash, contentHash(ORIGINAL as unknown as Json));
});

test("nothing reviewed is refused rather than minting a copy", () => {
  assert.throws(() => build({ reviews: [] }), NothingToDisclose);
});

test("a reason that quotes the policy is refused before anything is sealed", () => {
  const policy = "Refunds above 500 EUR require a second approver on the finance team.";
  assert.throws(
    () => build({ reviews: [review("c3", "fail", "pass", "2026-09-25T12:00:00Z", `Our policy says: ${policy}`)], privateMaterial: [policy] }),
    LeakError,
  );
});

test("a reissue of a reissue states the reissue limitation once", () => {
  const first = build().payload;
  const second = build({ original: first, originalHash: "d".repeat(64) }).payload;
  assert.equal(second.limitations, first.limitations);
});

test("both exports carry the review, and a report without one gains nothing", () => {
  const { payload, contentHash: hash } = build();
  const md = reportToMarkdown(payload, hash, "https://example.test/r");
  assert.match(md, /## Review by the tested party/);
  assert.match(md, /Not a score\./);
  assert.match(md, /Reissues an earlier report/);
  assert.match(reportToCsv(payload, hash), /Review by the tested party/);

  const plain = reportToMarkdown(ORIGINAL, "e".repeat(64), "https://example.test/r");
  assert.doesNotMatch(plain, /tested party|Reissues/);
  assert.doesNotMatch(reportToCsv(ORIGINAL, "e".repeat(64)), /tested party|Reissues/);
});
