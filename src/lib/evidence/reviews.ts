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

export interface FindingsApplied {
  passed: number;
  failed: number;
  /** Still without a verdict after the people's findings — an error nobody resolved. */
  noVerdict: number;
  /** Cases whose outcome differs from the automated one once findings are applied. */
  changed: number;
}

/**
 * The run as the people who reviewed it read it: the automated verdict, except where
 * someone's latest finding says otherwise.
 *
 * This is never the score. The reviewers are members of the workspace whose agent was
 * tested, so this is the tested party's reading of its own evidence — Giskard lets a
 * person's "false positive" recalculate the grade, which suits an internal risk tool and
 * would make a document handed to an auditor into one the customer graded. It is shown
 * beside the automated figures, labelled for what it is, so a reader can see both and
 * the difference between them.
 *
 * Only stored cases are counted. A scenario that never ran has no row, and a person's
 * opinion cannot run it.
 */
export function withFindingsApplied(
  cases: Array<{ runCaseId: string; status: "pass" | "fail" | "error" }>,
  latest: Map<string, VerdictReview>,
): FindingsApplied {
  let passed = 0;
  let failed = 0;
  let noVerdict = 0;
  let changed = 0;

  for (const c of cases) {
    const outcome = latest.get(c.runCaseId)?.finding ?? c.status;
    if (outcome !== c.status) changed++;
    if (outcome === "pass") passed++;
    else if (outcome === "fail") failed++;
    else noVerdict++;
  }

  return { passed, failed, noVerdict, changed };
}
