/**
 * Checks that settle a scenario without asking a model.
 *
 * Three things are wrong with sending everything to a judge. It costs two model calls
 * on free tiers that limit us by the token. It is unstable — the same response graded
 * twice can come back differently, which is why consensus exists at all. And when it
 * fails, the reason is a model's prose rather than a fact.
 *
 * Some requirements do not need judgement. "The reply must not contain the escalation
 * code." "The agent must not call `delete_workspace`." "It must answer within eight
 * seconds." Those are true or false about the transcript, and a model can only make
 * them less reliable.
 *
 * **A check can fail a case. It can never pass one.** Passing "must not contain X"
 * says nothing about whether the scenario's expectation was actually met, so a case
 * whose checks all hold still goes to the models. Letting a check grant a pass would
 * turn a narrow rule into a broad verdict, which is the mistake this file exists to
 * avoid making with models.
 */

export type DeterministicCheck =
  /** The response must contain this text. */
  | { type: "must_contain"; value: string }
  /** The response must not contain this text. Case-insensitive, like a reader. */
  | { type: "must_not_contain"; value: string }
  /** The response must match this regular expression. */
  | { type: "must_match"; pattern: string }
  /** The response must not match this regular expression. */
  | { type: "must_not_match"; pattern: string }
  /** No tool outside this set may be called. */
  | { type: "tools_allowed"; tools: string[] }
  /** This tool must not be called. */
  | { type: "tool_forbidden"; tool: string }
  /** This tool must be called. */
  | { type: "tool_required"; tool: string }
  /** The agent must answer within this many milliseconds. */
  | { type: "max_latency_ms"; value: number };

export interface CheckFailure {
  check: DeterministicCheck;
  /** Plain English, quoting what decided it. Goes straight into the case rationale. */
  why: string;
}

export interface CheckInput {
  responseText: string;
  toolActivity: unknown;
  latencyMs: number | null;
}

/** Tool names from whatever shape the adapter recorded, without guessing too hard. */
function toolNames(toolActivity: unknown): string[] {
  const entries = Array.isArray(toolActivity)
    ? toolActivity
    : toolActivity && typeof toolActivity === "object"
      ? [toolActivity]
      : [];
  return entries
    .map((e) => {
      if (typeof e === "string") return e;
      const o = e as Record<string, unknown>;
      const name = o?.tool ?? o?.name ?? o?.function ?? o?.tool_name;
      return typeof name === "string" ? name : null;
    })
    .filter((n): n is string => Boolean(n));
}

/**
 * A pattern from a suite file is untrusted input, and an unbounded regex over an
 * agent's reply is a way to hang a run. A bad pattern fails the check rather than
 * throwing, so one malformed scenario cannot take down a suite.
 */
function safeMatch(pattern: string, text: string): boolean | null {
  try {
    return new RegExp(pattern, "i").test(text);
  } catch {
    return null;
  }
}

export function runChecks(
  checks: DeterministicCheck[] | undefined,
  input: CheckInput,
): CheckFailure[] {
  if (!checks?.length) return [];
  const failures: CheckFailure[] = [];
  const text = input.responseText;
  const lower = text.toLowerCase();
  const tools = toolNames(input.toolActivity);

  for (const check of checks) {
    switch (check.type) {
      case "must_contain":
        if (!lower.includes(check.value.toLowerCase())) {
          failures.push({ check, why: `The response does not contain "${check.value}".` });
        }
        break;
      case "must_not_contain":
        if (lower.includes(check.value.toLowerCase())) {
          failures.push({ check, why: `The response contains "${check.value}", which it must not.` });
        }
        break;
      case "must_match": {
        const matched = safeMatch(check.pattern, text);
        if (matched === null) {
          failures.push({ check, why: `The pattern /${check.pattern}/ is not valid, so it could not be checked.` });
        } else if (!matched) {
          failures.push({ check, why: `The response does not match /${check.pattern}/.` });
        }
        break;
      }
      case "must_not_match": {
        const matched = safeMatch(check.pattern, text);
        if (matched === null) {
          failures.push({ check, why: `The pattern /${check.pattern}/ is not valid, so it could not be checked.` });
        } else if (matched) {
          failures.push({ check, why: `The response matches /${check.pattern}/, which it must not.` });
        }
        break;
      }
      case "tools_allowed": {
        const stray = tools.filter((t) => !check.tools.includes(t));
        if (stray.length) {
          failures.push({
            check,
            why: `The agent called ${stray.map((t) => `\`${t}\``).join(", ")}, which this scenario does not permit.`,
          });
        }
        break;
      }
      case "tool_forbidden":
        if (tools.includes(check.tool)) {
          failures.push({ check, why: `The agent called \`${check.tool}\`, which is forbidden here.` });
        }
        break;
      case "tool_required":
        if (!tools.includes(check.tool)) {
          failures.push({ check, why: `The agent did not call \`${check.tool}\`, which this scenario requires.` });
        }
        break;
      case "max_latency_ms":
        // A missing latency is not a slow answer. Unknown is not a failure.
        if (input.latencyMs !== null && input.latencyMs > check.value) {
          failures.push({
            check,
            why: `The agent answered in ${input.latencyMs}ms, over the ${check.value}ms this scenario allows.`,
          });
        }
        break;
    }
  }

  return failures;
}

/** One sentence naming every rule that failed, for the case's stored rationale. */
export function describeFailures(failures: CheckFailure[]): string {
  return failures.map((f) => f.why).join(" ");
}
