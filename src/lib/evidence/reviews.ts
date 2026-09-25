/**
 * What people said about verdicts, reduced to what a reader needs.
 *
 * A review sits beside a verdict and never replaces it (migration 0028). Two things
 * are derived from the stored reviews and nothing else:
 *
 * **The latest review per case.** A changed mind is a second row; the latest is what
 * the person currently thinks, and the earlier ones stay on record.
 *
 * **Alignment** — LangSmith's name for how often the automated verdict matched the
 * person's. It is computed only over verdicts that *were* verdicts. A review of an
 * errored or disputed case is not an agreement or a disagreement with anything, because
 * there was no finding to agree with; it is a person resolving a gap, and it is counted
 * as that instead. Folding the two together would let a run full of disputes, each
 * settled by hand, read as a grader that agreed with people every time.
 */

export type ReviewFinding = "pass" | "fail";

export interface VerdictReview {
  id: string;
  runCaseId: string;
  reviewerId: string;
  /** What the models or rules had found when the person read it. */
  verdictStatus: "pass" | "fail" | "error";
  finding: ReviewFinding;
  note: string;
  createdAt: string;
}

export function latestReviews(reviews: VerdictReview[]): Map<string, VerdictReview> {
  const latest = new Map<string, VerdictReview>();
  for (const review of reviews) {
    const current = latest.get(review.runCaseId);
    if (!current || review.createdAt > current.createdAt) latest.set(review.runCaseId, review);
  }
  return latest;
}

export interface Alignment {
  /** Reviews of a real verdict where the person reached the same finding. */
  agreed: number;
  /** Reviews of a real verdict where the person reached the opposite one. */
  disagreed: number;
  /** Reviews of a case that had no verdict — a person filling a gap, not grading a grader. */
  resolvedGaps: number;
  /** agreed / (agreed + disagreed), or null when no real verdict has been reviewed. */
  rate: number | null;
}

export function alignment(latest: Iterable<VerdictReview>): Alignment {
  let agreed = 0;
  let disagreed = 0;
  let resolvedGaps = 0;

  for (const review of latest) {
    if (review.verdictStatus === "error") resolvedGaps++;
    else if (review.verdictStatus === review.finding) agreed++;
    else disagreed++;
  }

  const judged = agreed + disagreed;
  return { agreed, disagreed, resolvedGaps, rate: judged === 0 ? null : agreed / judged };
}

/** Bounds shared by the form and the action, so the two cannot drift. */
export const REVIEW_NOTE_MIN = 10;
export const REVIEW_NOTE_MAX = 2000;
