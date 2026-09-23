/**
 * The agent's recorded steps, in one shape.
 *
 * What a customer's endpoint returns under `tool_activity` is whatever their stack
 * happens to emit: a list of `{tool, arguments, result}`, or `{name, args, output}`,
 * or OpenAI's `{function: {name, arguments}}`, or bare strings. Every consumer that
 * wanted to reason about it — the effect rule, the checks, the operator's case
 * detail — was re-guessing that shape, and each guess was slightly different.
 *
 * So it is normalised once, on read, from the blob already stored. No migration and
 * no new evidence: this is a view over `run_cases.tool_activity`, which is kept
 * verbatim and remains the thing a hash covers.
 *
 * **Fields we were not given stay absent.** No zero timings, no invented statuses. A
 * trajectory that says nothing about duration is a trajectory that said nothing about
 * duration, and filling that in would be the same sin as a model inventing a verdict.
 */

export interface AgentEvent {
  /** Position in the recorded order, from 1. The only ordering we ever actually have. */
  sequence: number;
  type: "tool_call" | "approval" | "error" | "unknown";
  /** The tool or step name, as the agent reported it. */
  name: string | null;
  /** Arguments, verbatim. Never shown in a client report. */
  arguments: unknown;
  /** Whatever the step returned, verbatim. Never shown in a client report. */
  result: unknown;
  /**
   * `failed` only when the step actually says so. Absent information is `unknown`,
   * not success — an agent that reports nothing has not reported a success.
   */
  status: "ok" | "failed" | "unknown";
}

const NAME_KEYS = ["tool", "name", "tool_name", "function_name"];
const ARG_KEYS = ["arguments", "args", "input", "parameters", "params"];
const RESULT_KEYS = ["result", "output", "response", "return_value"];

function read(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined) return source[key];
  }
  return undefined;
}

function nameOf(entry: Record<string, unknown>): string | null {
  const direct = read(entry, NAME_KEYS);
  if (typeof direct === "string" && direct.trim()) return direct;
  // OpenAI's tool-call shape nests the name a level down.
  const fn = entry.function;
  if (fn && typeof fn === "object") {
    const nested = (fn as Record<string, unknown>).name;
    if (typeof nested === "string" && nested.trim()) return nested;
  }
  if (typeof fn === "string" && fn.trim()) return fn;
  return null;
}

function statusOf(entry: Record<string, unknown>, result: unknown): AgentEvent["status"] {
  const raw = entry.status ?? entry.state ?? entry.outcome;
  if (typeof raw === "string") {
    if (/^(ok|success|succeeded|completed|done)$/i.test(raw)) return "ok";
    if (/^(fail|failed|error|errored|timeout|rejected|denied)$/i.test(raw)) return "failed";
  }
  if (entry.error !== undefined && entry.error !== null && entry.error !== "") return "failed";
  if (typeof result === "string" && /^(error|failed|timeout)/i.test(result)) return "failed";
  if (result !== undefined) return "ok";
  return "unknown";
}

function typeOf(entry: Record<string, unknown>, name: string | null): AgentEvent["type"] {
  const raw = entry.type ?? entry.kind;
  if (typeof raw === "string") {
    if (/approval|approve|authoris|authoriz|consent/i.test(raw)) return "approval";
    if (/error|failure/i.test(raw)) return "error";
    if (/tool|function|call/i.test(raw)) return "tool_call";
  }
  if (name && /approval|approve|authoris|authoriz|consent/i.test(name)) return "approval";
  return name ? "tool_call" : "unknown";
}

export function normaliseTrajectory(toolActivity: unknown): AgentEvent[] {
  const entries = Array.isArray(toolActivity)
    ? toolActivity
    : toolActivity && typeof toolActivity === "object"
      ? [toolActivity]
      : [];

  return entries
    // An entry with nothing in it is not a step. `{}` and `null` turn up in real
    // payloads as padding, and counting them as recorded activity would let an
    // agent evidence an action with an empty object.
    .filter((raw) => {
      if (typeof raw === "string") return raw.trim().length > 0;
      if (!raw || typeof raw !== "object") return false;
      return Object.keys(raw as Record<string, unknown>).length > 0;
    })
    .map((raw, i): AgentEvent => {
    if (typeof raw === "string") {
      return { sequence: i + 1, type: "tool_call", name: raw, arguments: undefined, result: undefined, status: "unknown" };
    }
    const entry = (raw ?? {}) as Record<string, unknown>;
    const name = nameOf(entry);
    const args = read(entry, ARG_KEYS) ?? (entry.function as Record<string, unknown> | undefined)?.arguments;
    const result = read(entry, RESULT_KEYS);
    return {
      sequence: i + 1,
      type: typeOf(entry, name),
      name,
      arguments: args,
      result,
      status: statusOf(entry, result),
    };
  });
}

/** Every tool name that was called, in order, ignoring steps that named nothing. */
export function toolSequence(events: AgentEvent[]): string[] {
  return events.filter((e) => e.type === "tool_call" && e.name).map((e) => e.name as string);
}

/** Flattened argument text, for rules that ask whether something leaked into a call. */
export function argumentText(event: AgentEvent): string {
  if (event.arguments === undefined || event.arguments === null) return "";
  return typeof event.arguments === "string" ? event.arguments : JSON.stringify(event.arguments);
}
