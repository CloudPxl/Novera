import type { RoutedChat, RoutedAttempt } from "../router/execute.ts";
import type { Candidate } from "../router/routes.ts";
import { parsePolicyChange, type PolicyChange } from "./parse.ts";

/**
 * Explaining one failed scenario and proposing the smallest policy change that would
 * have prevented it.
 *
 * This is the only place in Novera where a model writes something a customer might
 * ship. It is therefore a proposal and nothing else: it is stored as `proposed`, a
 * person approves or rejects it, and only an approval creates a policy version. The
 * model never edits a policy, and an unapproved proposal never reaches a report.
 */
export interface FailedCase {
  caseId: string;
  obligation: string;
  severity: string;
  input: string;
  expected: string;
  assertions: string[];
  responseText: string | null;
  rationale: string | null;
}

export interface DiagnosisOutcome {
  ok: boolean;
  change: PolicyChange | null;
  /** Why no usable proposal came back — shown to the operator verbatim. */
  error: string | null;
  servedBy: Candidate | null;
  attempts: RoutedAttempt[];
}

export const DIAGNOSE_SYSTEM = `You are given one scenario that a customer support agent handled badly, and the written policy the agent was operating under. Propose the smallest change to that policy which would have prevented the failure.

You are drafting a proposal for a human to approve. You are not editing the policy.

Rules:
- Change as little as possible. Prefer replacing one sentence over rewriting a section.
- If you replace existing text, quote it exactly as it appears in the policy. Never quote text that is not in the policy.
- If the policy simply says nothing about this situation, add a new instruction instead of replacing one.
- Write the replacement as policy text — an instruction to the agent — not as commentary about the policy.
- Do not propose anything the agent cannot actually do, and do not propose collecting more personal data than the task needs.
- Name the real risks of your change, especially any scenario it could newly break. If you can think of none, say so rather than inventing one.

Reply with a single JSON object and nothing else:
{"analysis":"two or three sentences on why the response failed","change":"replace"|"add","quoted_old":"exact text from the policy, or empty when adding","proposed_new":"the policy text to put there","risks":["what this change could break"]}`;

function buildPrompt(failure: FailedCase, policyBody: string): string {
  return [
    `Current policy:\n${policyBody}`,
    `Scenario the agent failed (${failure.caseId}, obligation: ${failure.obligation}, severity: ${failure.severity})`,
    `Customer input:\n${failure.input}`,
    `Expected behaviour:\n${failure.expected}`,
    `Assertions that had to hold:\n${failure.assertions.map((a, i) => `${i + 1}. ${a}`).join("\n")}`,
    `What the agent actually replied:\n${failure.responseText ?? "(the agent returned nothing)"}`,
    `Why it was graded a failure:\n${failure.rationale ?? "(no rationale recorded)"}`,
  ].join("\n\n---\n\n");
}

export async function diagnoseFailure(args: {
  chat: RoutedChat;
  failure: FailedCase;
  policyBody: string;
}): Promise<DiagnosisOutcome> {
  const { chat, failure, policyBody } = args;

  let response: Awaited<ReturnType<RoutedChat>>;
  try {
    response = await chat("diagnose", {
      system: DIAGNOSE_SYSTEM,
      messages: [{ role: "user", content: buildPrompt(failure, policyBody) }],
      maxTokens: 1400,
    }, { data: "redacted_customer" });
  } catch (error) {
    return {
      ok: false,
      change: null,
      error: `No model could produce a proposal: ${error instanceof Error ? error.message : String(error)}`,
      servedBy: null,
      attempts: (error as { attempts?: RoutedAttempt[] }).attempts ?? [],
    };
  }

  // The policy is checked against, not trusted from, the model: a proposal that
  // quotes text this policy does not contain is discarded here.
  const parsed = parsePolicyChange(response.text, policyBody);

  if (!parsed.ok) {
    return {
      ok: false,
      change: null,
      error: parsed.reason,
      servedBy: response.servedBy,
      attempts: response.attempts,
    };
  }

  return {
    ok: true,
    change: parsed.change,
    error: null,
    servedBy: response.servedBy,
    attempts: response.attempts,
  };
}
