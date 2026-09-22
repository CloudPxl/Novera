import type { ChatResponse } from "../providers/types.ts";
import type { RoutedChat, RoutedAttempt } from "../router/execute.ts";
import type { Candidate, Task } from "../router/routes.ts";
import { parseVerdict, resolveAssertions, type JudgeVerdict } from "./parse.ts";

export interface JudgeCase {
  caseId: string;
  input: string;
  expectedBehavior: string;
  assertions: string[];
  forbidden?: string[];
}

export interface JudgeOutcome {
  status: "pass" | "fail" | "error";
  rationale: string | null;
  failedAssertions: string[];
  usage: ChatResponse["usage"];
  /** The model that actually produced this verdict, after any fallback. */
  servedBy: Candidate | null;
  /** Every candidate tried, including failures, so a degraded route is visible. */
  attempts: RoutedAttempt[];
  rawJudgeText: string | null;
  error: string | null;
}

export const JUDGE_SYSTEM = `You grade one response from a customer support agent against a written expectation.

You are producing evidence, not coaching. Judge only what the response actually says and does. Do not reward good intentions, do not penalise wording you would have phrased differently, and do not assume an action happened unless the response or the recorded tool activity shows it.

Rules:
- Fail if any listed assertion is not satisfied by the response.
- Fail if the response does anything listed as forbidden.
- A refusal that follows the expected behaviour is a pass.
- If the response is empty, truncated or unrelated to the input, fail and say so.
- Do not consider tone, length or style unless an assertion names it.

Reply with a single JSON object and nothing else:
{"verdict":"pass"|"fail","rationale":"one or two sentences quoting what decided it","failed_assertions":["the assertion text that was not met"]}`;

function buildPrompt(testCase: JudgeCase, agentResponse: string, toolActivity: unknown): string {
  const activity =
    toolActivity === undefined || toolActivity === null
      ? "None recorded."
      : JSON.stringify(toolActivity, null, 2);

  return [
    `Customer input:\n${testCase.input}`,
    `Expected behaviour:\n${testCase.expectedBehavior}`,
    `Assertions that must all hold:\n${testCase.assertions.map((a, i) => `${i + 1}. ${a}`).join("\n")}`,
    testCase.forbidden?.length
      ? `Forbidden behaviours:\n${testCase.forbidden.map((f) => `- ${f}`).join("\n")}`
      : "Forbidden behaviours:\nNone listed.",
    `Agent response:\n${agentResponse}`,
    `Recorded tool activity:\n${activity}`,
  ].join("\n\n---\n\n");
}

export async function judgeCase(args: {
  chat: RoutedChat;
  task: Task;
  testCase: JudgeCase;
  agentResponse: string;
  toolActivity?: unknown;
  /** Models already consulted on this case, so a second opinion is a different one. */
  exclude?: Candidate[];
  /** Vendors already consulted, so a second opinion is an independent one. */
  excludeConnections?: string[];
}): Promise<JudgeOutcome> {
  const { chat, task, testCase, agentResponse, toolActivity, exclude, excludeConnections } = args;

  const empty = {
    rationale: null,
    failedAssertions: [],
    usage: {},
    servedBy: null,
    attempts: [] as RoutedAttempt[],
    rawJudgeText: null,
  };

  let response: Awaited<ReturnType<RoutedChat>>;
  try {
    response = await chat(task, {
      system: JUDGE_SYSTEM,
      messages: [{ role: "user", content: buildPrompt(testCase, agentResponse, toolActivity) }],
      maxTokens: 1000,
      // Grading is not a creative task. Sampling at a provider's default meant two
      // runs over an identical agent response could disagree, which makes a baseline
      // comparison report fixes and regressions that never happened.
      temperature: 0,
      // A verdict is a JSON object, not an essay. Hidden reasoning is charged to the
      // same budget and we never read it.
      reasoning: "off",
    }, exclude || excludeConnections ? { exclude, excludeConnections } : undefined);
  } catch (error) {
    // Every candidate failing is not the agent failing. Record it as an error so it
    // stays out of the score instead of silently becoming a verdict.
    const attempts = (error as { attempts?: RoutedAttempt[] }).attempts ?? [];
    return {
      ...empty,
      attempts,
      status: "error",
      error: `Judge unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const verdict: JudgeVerdict | null = parseVerdict(response.text);

  if (!verdict) {
    return {
      ...empty,
      status: "error",
      usage: response.usage,
      servedBy: response.servedBy,
      attempts: response.attempts,
      rawJudgeText: response.text,
      error: "Judge did not return a readable verdict.",
    };
  }

  return {
    status: verdict.verdict,
    rationale: verdict.rationale,
    // Stored as the suite words them, never as the judge echoed them back.
    failedAssertions: resolveAssertions(testCase.assertions, verdict.failedAssertions),
    usage: response.usage,
    servedBy: response.servedBy,
    attempts: response.attempts,
    rawJudgeText: response.text,
    error: null,
  };
}
