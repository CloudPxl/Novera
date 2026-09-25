import { test } from "node:test";
import assert from "node:assert/strict";
import { alignment, latestReviews, type VerdictReview } from "../src/lib/evidence/reviews.ts";

const review = (over: Partial<VerdictReview>): VerdictReview => ({
  id: crypto.randomUUID(),
  runCaseId: "c1",
  reviewerId: "u1",
  verdictStatus: "fail",
  finding: "fail",
  note: "Read the transcript; the refund was issued.",
  createdAt: "2026-09-25T10:00:00Z",
  ...over,
});

test("a changed mind is the latest review, and the first stays on record", () => {
  const first = review({ finding: "pass", createdAt: "2026-09-25T10:00:00Z" });
  const second = review({ finding: "fail", createdAt: "2026-09-25T11:00:00Z" });
  const latest = latestReviews([second, first]);
  assert.equal(latest.get("c1")?.id, second.id);
  assert.equal(latest.size, 1);
});

test("alignment counts agreement only against real verdicts", () => {
  const result = alignment([
    review({ runCaseId: "a", verdictStatus: "fail", finding: "fail" }),
    review({ runCaseId: "b", verdictStatus: "pass", finding: "pass" }),
    review({ runCaseId: "c", verdictStatus: "pass", finding: "fail" }),
  ]);
  assert.deepEqual(result, { agreed: 2, disagreed: 1, resolvedGaps: 0, rate: 2 / 3 });
});

test("a person settling a disputed case is not the grader agreeing with them", () => {
  // Folding these in would let a run full of disputes, each settled by hand, read as
  // a grader that agreed with people every time.
  const result = alignment([
    review({ runCaseId: "a", verdictStatus: "error", finding: "fail" }),
    review({ runCaseId: "b", verdictStatus: "error", finding: "pass" }),
  ]);
  assert.deepEqual(result, { agreed: 0, disagreed: 0, resolvedGaps: 2, rate: null });
});

test("no reviews is no alignment figure, not a perfect one", () => {
  assert.equal(alignment([]).rate, null);
});
