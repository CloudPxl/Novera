import { independenceOf, vendorsOf } from "../../../../lib/judge/independence.ts";

/**
 * How firm a verdict is, in one line.
 *
 * Every verdict is put to two models, so "graded by X" alone would overstate a case
 * where only one model could be reached and understate one where three were consulted.
 *
 * It also says whether the models were from different vendors. "Confirmed by a second
 * model" was doing too much work: until 2026-09-22 that second model could be another
 * of the same vendor's family, sharing a lineage and a rate limit with the first.
 */
export function gradingNote(
  model: string,
  agreement: string | null,
  votes?: Array<{ model?: unknown; status?: unknown; redacted?: unknown; rationale?: unknown }>,
): string {
  const base = baseNote(model, agreement, votes);
  // Said on the case it happened to, so the reader of a privacy scenario knows a
  // grader saw placeholders rather than the agent's exact words.
  const redacted = (votes ?? []).filter((v) => v?.redacted === true && typeof v.model === "string").map((v) => v.model as string);
  return redacted.length
    ? `${base}; ${redacted.join(" and ")} read the reply with personal data replaced by placeholders`
    : base;
}

function baseNote(
  model: string,
  agreement: string | null,
  votes?: Array<{ model?: unknown; status?: unknown; rationale?: unknown }>,
): string {
  const usable = (votes ?? []).filter(
    (v): v is { model: string; status: "pass" | "fail" | "error" } =>
      typeof v?.model === "string" && typeof v?.status === "string",
  );
  // Rows from before votes were recorded say nothing rather than claiming either way.
  const across = usable.length ? independenceOf(usable) === "independent" : null;
  const vendors = vendorsOf(usable);
  const second =
    across === null
      ? "a second model"
      : across
        ? `a second model from ${vendors[1] ?? "another vendor"}`
        : `a second ${vendors[0] ?? "same-vendor"} model — no other vendor was reachable`;

  switch (agreement) {
    case "agreed":
      return `graded by ${model}, confirmed by ${second}`;
    case "majority":
      return `graded by ${model} after two models disagreed and a third settled it`
        + (vendors.length > 1 ? ` (${vendors.join(", ")})` : "");
    case "unconfirmed": {
      // Why, when the missing vote recorded it (0 for rows before 2026-09-29).
      const missing = (votes ?? []).find((v) => v?.status === "error" && typeof v.rationale === "string");
      const why = typeof missing?.rationale === "string" ? /^No grader could answer: (.+?)\.?$/.exec(missing.rationale)?.[1] : undefined;
      return `graded by ${model} alone — no second model was reachable${why ? ` (${why})` : ""}`;
    }
    case "unresolved":
      return "no verdict: the models disagreed and the tie could not be broken";
    default:
      return `graded by ${model}`;
  }
}

export interface Corroboration {
  agreed: number;
  /** Of `agreed`, those where both models came from one vendor. */
  sameVendor: number;
  settled: number;
  unconfirmed: number;
  unresolved: number;
  /** Verdicts settled by the scenario's own rules, with no model asked (0017). */
  rules: number;
  /** Verdicts settled by reading back the customer's system, with no model asked (0020). */
  readBack: number;
}

/** "by the scenario's own rules", "by reading back the customer's system", or both. */
function withoutModel(c: Corroboration): string | null {
  const n = c.rules + c.readBack;
  if (!n) return null;
  const how = !c.readBack
    ? "by the scenario's own rules"
    : !c.rules
      ? "by reading back the customer's system"
      : `${c.rules} by the scenario's own rules and ${c.readBack} by reading back the customer's system`;
  return `settled without a model, ${how}`;
}

/**
 * The run's verdicts in one sentence: how many were corroborated, and how. A verdict
 * settled by a rule or a read-back carries no agreement by construction (0020), so it
 * is counted here on its own — before, a run settled entirely by rules read "No verdict
 * was recorded" above a list of its failures.
 */
export function engineLine(c: Corroboration, judgeModel: string | null): string {
  const total = c.agreed + c.settled + c.unconfirmed + c.unresolved;
  const other = withoutModel(c);
  const n = c.rules + c.readBack;
  if (total === 0) {
    if (other) return `${n} ${n === 1 ? "verdict was" : "verdicts were"} ${other}.`;
    return judgeModel ? `Graded by ${judgeModel}.` : "No verdict was recorded.";
  }

  const parts = [`${c.agreed} of ${total} ${other ? "model verdicts" : "verdicts"} were confirmed by a second model`
    + (c.sameVendor ? ` (${c.sameVendor === c.agreed ? "all" : c.sameVendor} by two models from one vendor)` : "")];
  if (c.settled) parts.push(`${c.settled} needed a third to settle a disagreement`);
  if (c.unconfirmed) parts.push(`${c.unconfirmed} could not be corroborated`);
  if (c.unresolved) parts.push(`${c.unresolved} could not be resolved at all`);
  if (other) parts.push(`and ${n} more ${n === 1 ? "was" : "were"} ${other}`);
  return `${parts.join(", ")}.`;
}
