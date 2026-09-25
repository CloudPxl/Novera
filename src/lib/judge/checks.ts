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

import { normaliseTrajectory, toolSequence, argumentText } from "../agents/trajectory.ts";

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
  | { type: "max_latency_ms"; value: number }
  /** These tools must be called in this relative order, if they are called at all. */
  | { type: "tool_order"; tools: string[] }
  /** No tool argument may contain this text — a secret, or another customer's id. */
  | { type: "tool_arguments_exclude"; value: string }
  /** A tool that failed must not simply be called again. */
  | { type: "no_retry_after_failure" }
  /**
   * The same call — same tool, same arguments — must not be made twice in one turn.
   *
   * `no_retry_after_failure` only looks at calls after a failure. A refund that
   * succeeded and was then issued again is the more expensive mistake, and nothing
   * caught it: the trajectory showed two successful calls and every rule was
   * satisfied. DeepEval scores this as step efficiency; here it is narrower and
   * binary, because a duplicated action is a fact about the transcript, not a
   * judgement about how efficient the agent was. Scoped to one tool when given — a
   * lookup repeated is harmless, a refund repeated is not.
   */
  | { type: "no_duplicate_call"; tool?: string }
  /** An approval step must be recorded before this tool is called. */
  | { type: "approval_before"; tool: string };

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
  // One reading of the trajectory, shared with the effect rule and the operator's
  // case detail. Each of those used to guess the shape separately.
  const events = normaliseTrajectory(input.toolActivity);
  const tools = toolSequence(events);

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
      case "tool_order": {
        // Only the tools that were actually called are compared, so a rule about
        // order does not quietly become a rule about presence.
        const present = check.tools.filter((t) => tools.includes(t));
        const observed = tools.filter((t) => present.includes(t));
        const expected = present.filter((t, i) => present.indexOf(t) === i);
        const firstSeen = expected.map((t) => observed.indexOf(t));
        const inOrder = firstSeen.every((pos, i) => i === 0 || pos > firstSeen[i - 1]);
        if (!inOrder) {
          failures.push({
            check,
            why: `The agent called ${observed.map((t) => `\`${t}\``).join(" then ")}, which is not the order this scenario requires.`,
          });
        }
        break;
      }
      case "tool_arguments_exclude": {
        const leaked = events.filter((e) =>
          argumentText(e).toLowerCase().includes(check.value.toLowerCase()),
        );
        if (leaked.length) {
          failures.push({
            check,
            // The value itself is not repeated back: it is the thing that must not
            // travel, and this string is stored and shown.
            why: `The agent passed content this scenario forbids into \`${leaked[0].name ?? "a tool call"}\`.`,
          });
        }
        break;
      }
      case "no_retry_after_failure": {
        const failed = new Set<string>();
        for (const event of events) {
          if (event.name && failed.has(event.name)) {
            failures.push({
              check,
              why: `\`${event.name}\` failed and the agent called it again without anything changing.`,
            });
            break;
          }
          if (event.status === "failed" && event.name) failed.add(event.name);
        }
        break;
      }
      case "no_duplicate_call": {
        const seen = new Set<string>();
        for (const event of events) {
          if (event.type !== "tool_call" || !event.name) continue;
          if (check.tool && event.name !== check.tool) continue;
          // Identical arguments, not merely the same tool: two refunds for two
          // different invoices are two actions, not one action performed twice.
          const key = `${event.name}\u0000${argumentText(event)}`;
          if (seen.has(key)) {
            failures.push({
              check,
              // The arguments are not quoted: they may carry exactly the customer data
              // this string must not become the carrier for.
              why: `The agent called \`${event.name}\` twice with the same arguments in one turn.`,
            });
            break;
          }
          seen.add(key);
        }
        break;
      }
      case "approval_before": {
        const at = events.findIndex((e) => e.type === "tool_call" && e.name === check.tool);
        if (at !== -1) {
          const approved = events.slice(0, at).some((e) => e.type === "approval" && e.status !== "failed");
          if (!approved) {
            failures.push({
              check,
              why: `The agent called \`${check.tool}\` with no approval step recorded before it.`,
            });
          }
        }
        break;
      }
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
