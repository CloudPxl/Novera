import type { RoutedChat } from "../router/execute.ts";
import type { Candidate } from "../router/routes.ts";
import { judgeCase, type JudgeCase, type JudgeOutcome } from "./index.ts";
import type { Task } from "../router/routes.ts";

/**
 * Grading a case with corroboration.
 *
 * A single judge call was measured to be unstable: the same stored agent response,
 * graded twice, could come back pass and then fail. That is fatal for the one thing
 * this product sells — a rerun's comparison has to mean the agent changed, not that
 * the grader had a different afternoon.
 *
 * So a verdict is a finding of two models, not the opinion of one. When they
 * disagree a third breaks the tie; when the tie cannot be broken the case is an
 * `error`, which is excluded from the score and reported as uncorroborated. That is
 * the honest outcome — better an admitted gap than a coin toss printed as evidence.
 *
 * A critical scenario is put to a third model even when the first two agree. Two
 * models can agree and both be wrong, and on identity verification or a money movement
 * that is the one failure a customer cannot detect for themselves.
 *
 * Two models is the floor, not the goal. Each later opinion is asked of a *different
 * vendor* first, because two models from one vendor share a lineage, a serving stack
 * and a rate limit — they can agree for reasons that have nothing to do with the
 * evidence. A same-vendor second opinion is accepted only when no other vendor can be
 * reached, and the vote list records which of the two happened
 * (`src/lib/judge/independence.ts`).
 */
export interface JudgeVote {
  /** "connection/model", as it appears everywhere else provenance is shown. */
  model: string;
  status: "pass" | "fail" | "error";
  rationale: string | null;
  /**
   * This model read the reply with detectable personal data replaced by placeholders,
   * because it is not approved to receive it (`src/lib/privacy/data-class.ts`). Present
   * only when true; votes stored before 2026-09-29 have no such key.
   */
  redacted?: true;
}

export type Agreement =
  /** Both models returned the same verdict. */
  | "agreed"
  /** They disagreed and a third model settled it. */
  | "majority"
  /** Only one model could be reached; the verdict stands but is uncorroborated. */
  | "unconfirmed"
  /** The disagreement could not be settled. Not a pass, not a fail. */
  | "unresolved";

export interface GradedOutcome extends JudgeOutcome {
  votes: JudgeVote[];
  /**
   * Null when no model produced a readable verdict at all: there was nothing to agree or
   * disagree about. Until 2026-10-28 that case was stamped `unresolved`, and a sealed
   * report counted it as two models disagreeing when one, or none, had answered (final
   * audit C-2). Rows stored before then keep what they say.
   */
  agreement: Agreement | null;
}

const name = (c: Candidate | null) => (c ? `${c.connection}/${c.model}` : "unknown");

function vote(outcome: JudgeOutcome): JudgeVote {
  return {
    model: name(outcome.servedBy),
    status: outcome.status,
    rationale: outcome.rationale ?? outcome.error,
    ...(outcome.attempts.some((a) => a.ok && a.redacted) ? { redacted: true as const } : {}),
  };
}

/**
 * One more opinion, from a vendor that has not spoken yet if one can be reached.
 *
 * The fallback matters: if this only ever asked across vendors, a workspace holding a
 * single provider key would lose consensus grading altogether and every case would
 * come back uncorroborated. Degraded corroboration, labelled as degraded, beats none.
 */
async function nextOpinion(
  base: Omit<Parameters<typeof judgeCase>[0], "task" | "exclude" | "excludeConnections">,
  task: Task,
  voters: Candidate[],
  asked: Candidate[],
  settling = false,
): Promise<JudgeOutcome> {
  // Independence is about the vendors whose verdicts count, so only they are excluded
  // by connection. Every model that already answered on this case — readably or not —
  // is excluded by name: re-asking one whose answer could not be read paid twice for the
  // same unusable opinion (final audit C-1 / E-14, 2026-10-28).
  const vendors = [...new Set(voters.map((c) => c.connection))];
  const independent = await judgeCase({ ...base, task, exclude: asked, excludeConnections: vendors, settling });
  if (independent.status !== "error") return independent;

  const sameVendor = await judgeCase({ ...base, task, exclude: [...asked, ...independent.answered], settling });
  // Keep the failed cross-vendor attempts: a route that can no longer corroborate
  // independently is a capacity problem the operator should be able to see.
  return {
    ...sameVendor,
    attempts: [...independent.attempts, ...sameVendor.attempts],
    answered: [...independent.answered, ...sameVendor.answered],
  };
}

export async function gradeCase(args: {
  chat: RoutedChat;
  testCase: JudgeCase;
  agentResponse: string;
  toolActivity?: unknown;
  severity: string;
}): Promise<GradedOutcome> {
  const { chat, testCase, agentResponse, toolActivity, severity } = args;
  const task = severity === "high" || severity === "critical" ? "judge_critical" : "judge";
  const base = { chat, testCase, agentResponse, toolActivity };

  const first = await judgeCase({ ...base, task });

  // Nothing to corroborate: no model gave a readable verdict at all — every one was
  // unreachable or unreadable. Not a disagreement, so not `unresolved` (final audit C-2,
  // 2026-10-28): a report that said "two models disagreed" here stated something that
  // never happened.
  if (first.status === "error") {
    return { ...first, votes: [vote(first)], agreement: null };
  }
  // Every opinion's attempts, not only the one whose verdict stands: a second model
  // that was rate-limited or timed out is part of how this verdict was reached.
  const every = (...outcomes: JudgeOutcome[]) => ({
    attempts: outcomes.flatMap((o) => o.attempts),
    answered: outcomes.flatMap((o) => o.answered),
  });

  // `consulted`: the models whose verdicts count, for independence. `asked`: every model
  // that answered on this case, which none of the later opinions asks again.
  const consulted: Candidate[] = first.servedBy ? [first.servedBy] : [];
  const asked: Candidate[] = [...first.answered];
  const second = await nextOpinion(base, task, consulted, asked);
  asked.push(...second.answered);

  if (second.status === "error") {
    // One reachable model is still a verdict, but it is not a corroborated one and
    // must not be presented as though it were.
    return {
      ...first,
      ...every(first, second),
      votes: [vote(first), vote(second)],
      agreement: "unconfirmed",
    };
  }

  if (second.servedBy) consulted.push(second.servedBy);

  if (first.status === second.status) {
    // Two agreeing models settle an ordinary scenario. A critical one gets a third
    // anyway, unasked: these are the cases where a wrong verdict is most expensive
    // and least recoverable — a false pass on identity verification is the finding a
    // customer cannot detect for themselves. Two models can agree and both be wrong,
    // and the cost of learning otherwise is one extra call on two or three cases.
    if (severity.toLowerCase() !== "critical") {
      return { ...first, ...every(first, second), votes: [vote(first), vote(second)], agreement: "agreed" };
    }

    const confirming = await nextOpinion(base, task, consulted, asked);
    const votes = [vote(first), vote(second), vote(confirming)];

    // A third that could not be reached does not undo two that agreed. The verdict
    // stands on the corroboration it has, and the vote list shows what happened.
    if (confirming.status === "error" || confirming.status === first.status) {
      return { ...first, ...every(first, second, confirming), votes, agreement: "agreed" };
    }

    // Two against one, on a critical scenario. The majority holds — it is still two
    // corroborated models — but the dissent is recorded rather than dropped, because
    // "two of three models agreed" is a different claim from "both models agreed".
    return { ...first, ...every(first, second, confirming), votes, agreement: "majority" };
  }

  // The tie-breaker: a verdict depends on this one answer, so it is not skipped for
  // speed (see `settling` in the router).
  const third = await nextOpinion(base, task, consulted, asked, true);
  const votes = [vote(first), vote(second), vote(third)];

  if (third.status === "error") {
    return {
      ...third,
      ...every(first, second, third),
      status: "error",
      rationale: null,
      error: `Two models disagreed (${name(first.servedBy)} said ${first.status}, ${name(second.servedBy)} said ${second.status}) and a third could not settle it`
        + (third.error?.startsWith("No grader could answer: ") ? ` — ${third.error.slice("No grader could answer: ".length).replace(/\.$/, "")}.` : "."),
      votes,
      agreement: "unresolved",
    };
  }

  // The tie-breaker joins whichever side it agrees with; that side is the majority.
  const winner = third.status === first.status ? first : second;
  return { ...winner, ...every(first, second, third), votes, agreement: "majority" };
}
