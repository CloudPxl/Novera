import type { RoutedChat } from "../router/execute.ts";
import type { Candidate } from "../router/routes.ts";
import { judgeCase, type JudgeCase, type JudgeOutcome } from "./index.ts";

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
 */
export interface JudgeVote {
  /** "connection/model", as it appears everywhere else provenance is shown. */
  model: string;
  status: "pass" | "fail" | "error";
  rationale: string | null;
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
  agreement: Agreement;
}

const name = (c: Candidate | null) => (c ? `${c.connection}/${c.model}` : "unknown");

function vote(outcome: JudgeOutcome): JudgeVote {
  return {
    model: name(outcome.servedBy),
    status: outcome.status,
    rationale: outcome.rationale ?? outcome.error,
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

  // Nothing to corroborate: no model could grade this at all.
  if (first.status === "error") {
    return { ...first, votes: [vote(first)], agreement: "unresolved" };
  }

  const consulted: Candidate[] = first.servedBy ? [first.servedBy] : [];
  const second = await judgeCase({ ...base, task, exclude: consulted });

  if (second.status === "error") {
    // One reachable model is still a verdict, but it is not a corroborated one and
    // must not be presented as though it were.
    return {
      ...first,
      votes: [vote(first), vote(second)],
      agreement: "unconfirmed",
    };
  }

  if (second.servedBy) consulted.push(second.servedBy);

  if (first.status === second.status) {
    return { ...first, votes: [vote(first), vote(second)], agreement: "agreed" };
  }

  const third = await judgeCase({ ...base, task, exclude: consulted });
  const votes = [vote(first), vote(second), vote(third)];

  if (third.status === "error") {
    return {
      ...third,
      status: "error",
      rationale: null,
      error: `Two models disagreed (${name(first.servedBy)} said ${first.status}, ${name(second.servedBy)} said ${second.status}) and a third could not settle it.`,
      votes,
      agreement: "unresolved",
    };
  }

  // The tie-breaker joins whichever side it agrees with; that side is the majority.
  const winner = third.status === first.status ? first : second;
  return { ...winner, votes, agreement: "majority" };
}
