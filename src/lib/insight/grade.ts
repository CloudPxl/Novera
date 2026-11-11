import type { RoutedChat } from "../router/execute.ts";
import type { SuiteCase } from "../runner/types.ts";
import { gradeCase, type Agreement, type JudgeVote, type PendingGrading } from "../judge/consensus.ts";
import { describeFailures, runChecks } from "../judge/checks.ts";

/**
 * One captured reply, graded the way a run grades a case (src/lib/runner/execute.ts): the
 * scenario's rules first — they can fail it and never pass it — then the AI graders' consensus.
 * There is no read-back and no tool activity: a widget reply carries neither. No reply, or a
 * reply the worker could not see settle, is never graded: there is nothing whole to grade.
 */
export type GradeResult =
  | { kind: "ungraded"; reason: "no_reply" | "partial" }
  | {
      kind: "graded";
      status: "pass" | "fail" | "error";
      rationale: string | null;
      failedAssertions: string[];
      judgeModel: string | null;
      judgeVotes: JudgeVote[];
      judgeAgreement: Agreement | null;
      settledBy: "deterministic" | "models";
      error: string | null;
      /** Stopped short only for Novera's grading capacity: a later grading can resume from here. */
      pending?: PendingGrading;
    };

export async function gradeObservation(args: {
  chat: RoutedChat;
  scenario: SuiteCase;
  responseText: string | null;
  partial: boolean;
  /** Resume a grading deferred for capacity (src/lib/insight/grading-state.ts). */
  resume?: PendingGrading;
}): Promise<GradeResult> {
  const { chat, scenario, responseText, partial, resume } = args;
  if (responseText === null || responseText.trim() === "") return { kind: "ungraded", reason: "no_reply" };
  if (partial) return { kind: "ungraded", reason: "partial" };

  const failures = runChecks(scenario.checks, { responseText, toolActivity: null, latencyMs: null });
  if (failures.length) {
    return {
      kind: "graded",
      status: "fail",
      rationale: describeFailures(failures),
      failedAssertions: failures.map((f) => f.why),
      judgeModel: null,
      judgeVotes: [],
      judgeAgreement: null,
      settledBy: "deterministic",
      error: null,
    };
  }

  const outcome = await gradeCase({
    chat,
    severity: scenario.severity,
    testCase: {
      caseId: scenario.id,
      input: scenario.input,
      expectedBehavior: scenario.expected_behavior,
      assertions: scenario.assertions,
      forbidden: scenario.forbidden,
    },
    agentResponse: responseText,
    ...(resume ? { resume } : {}),
  });
  return {
    kind: "graded",
    status: outcome.status,
    rationale: outcome.rationale,
    failedAssertions: outcome.failedAssertions,
    judgeModel: outcome.servedBy ? `${outcome.servedBy.connection}/${outcome.servedBy.model}` : null,
    judgeVotes: outcome.votes,
    judgeAgreement: outcome.agreement,
    settledBy: "models",
    error: outcome.status === "error" ? (outcome.error ?? "No AI grader produced a usable verdict.") : null,
    ...(outcome.pending ? { pending: outcome.pending } : {}),
  };
}
