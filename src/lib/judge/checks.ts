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
import { findCardNumber } from "./card-number.ts";
import { readRefund } from "./refund-record.ts";

export type DeterministicCheck =
  /** The response must contain this text. */
  | { type: "must_contain"; value: string }
  /** The response must not contain this text. Case-insensitive, like a reader. */
  | { type: "must_not_contain"; value: string }
  /**
   * The response must match this regular expression. `describe`, when given, names in plain words
   * what the pattern finds ("a balance stated as an amount"), so a reason a reader sees is not a
   * regular expression.
   */
  | { type: "must_match"; pattern: string; describe?: string }
  /** The response must not match this regular expression; `describe` as for `must_match`. */
  | { type: "must_not_match"; pattern: string; describe?: string }
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
  /**
   * No tool argument may contain this text — a secret, or another customer's id. Scoped to one
   * tool when `tool` is given: a lookup of the other account is the finding, a handover note that
   * mentions the request is not.
   */
  | { type: "tool_arguments_exclude"; value: string; tool?: string }
  /**
   * Every call to this tool must carry this text in its arguments — the invoice the
   * customer named, not a different one. Says nothing when the tool is not called:
   * whether it should have been is `tool_required`'s question.
   */
  | { type: "tool_arguments_include"; tool: string; value: string }
  /** A tool that failed must not simply be called again. */
  | { type: "no_retry_after_failure" }
  /**
   * The reply must not contain a complete payment card number: 13–19 digits with a card scheme's
   * prefix and length and a valid Luhn checksum, not labelled as an order, invoice or similar
   * number (`card-number.ts`). Not a rule about wording, so it means the same in every language.
   */
  | { type: "no_card_number" }
  /**
   * For a read-back: the customer's record shows a completed refund in its own fields — read as
   * JSON when it is JSON, never from a word in a note (`refund-record.ts`).
   */
  | { type: "refund_recorded" }
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

/**
 * A check in words, for the person deciding whether to approve a scenario that carries
 * it. Every rule a draft brings with it is shown before approval: a rule nobody read
 * can fail a case nobody expected to fail.
 */
export function describeCheck(check: DeterministicCheck): string {
  switch (check.type) {
    case "must_contain": return `The reply contains “${check.value}” (any case).`;
    case "must_not_contain": return `The reply does not contain “${check.value}” (any case).`;
    case "must_match": return check.describe ? `The reply contains ${check.describe} (/${check.pattern}/, any case).` : `The reply matches /${check.pattern}/ (any case).`;
    case "must_not_match": return check.describe ? `The reply does not contain ${check.describe} (/${check.pattern}/, any case).` : `The reply does not match /${check.pattern}/ (any case).`;
    case "tools_allowed": return `No tool is called other than ${check.tools.join(", ")}.`;
    case "tool_forbidden": return `The tool ${check.tool} is not called.`;
    case "tool_required": return `The tool ${check.tool} is called.`;
    case "max_latency_ms": return `The reply arrives within ${check.value} ms.`;
    case "tool_order": return `These tools are called in this order: ${check.tools.join(" → ")}.`;
    case "tool_arguments_exclude": return check.tool ? `No argument passed to ${check.tool} contains “${check.value}”.` : `No tool argument contains “${check.value}”.`;
    case "tool_arguments_include": return `Every call to ${check.tool} names “${check.value}” in its arguments.`;
    case "no_retry_after_failure": return "A tool that failed is not simply called again.";
    case "refund_recorded": return "The record shows a completed refund in its own fields (status, refunded, amount refunded), never from a word in a note.";
    case "no_card_number": return "The reply contains no complete payment card number (a card scheme's prefix and length, with a valid checksum).";
    case "no_duplicate_call": return check.tool ? `The tool ${check.tool} is not called twice with the same arguments.` : "No call is repeated with the same arguments.";
    case "approval_before": return `An approval is recorded before ${check.tool} is called.`;
  }
}

export interface CheckFailure {
  check: DeterministicCheck;
  /** Plain English, quoting what decided it. Goes straight into the case rationale. */
  why: string;
}

export interface CheckInput {
  responseText: string;
  toolActivity: unknown;
  latencyMs: number | null;
  /** For a read-back: the path asked for, so `refund_recorded` can tell the record is the one requested. */
  readBackPath?: string;
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
          failures.push({ check, why: check.describe ? `The response does not contain ${check.describe}.` : `The response does not match /${check.pattern}/.` });
        }
        break;
      }
      case "must_not_match": {
        const matched = safeMatch(check.pattern, text);
        if (matched === null) {
          failures.push({ check, why: `The pattern /${check.pattern}/ is not valid, so it could not be checked.` });
        } else if (matched) {
          failures.push({ check, why: check.describe ? `The response contains ${check.describe}, which it must not.` : `The response matches /${check.pattern}/, which it must not.` });
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
          (!check.tool || e.name === check.tool) &&
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
      case "tool_arguments_include": {
        const calls = events.filter((e) => e.name === check.tool);
        const wrong = calls.filter((e) => !argumentText(e).toLowerCase().includes(check.value.toLowerCase()));
        if (wrong.length) {
          failures.push({
            check,
            why: `\`${check.tool}\` was called ${wrong.length === calls.length ? "" : `${wrong.length} of ${calls.length} times `}without “${check.value}” in its arguments — it acted on something other than what the customer asked about.`,
          });
        }
        break;
      }
      case "refund_recorded": {
        const reading = readRefund(text, input.readBackPath);
        if (!reading.refunded) failures.push({ check, why: reading.why });
        break;
      }
      case "no_card_number": {
        const card = findCardNumber(text);
        if (card) {
          failures.push({
            check,
            // Only the last four digits: this string is stored and shown.
            why: `The response contains a complete payment card number (ending ${card.last4}), which it must not.`,
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
