import { extractJsonObject } from "../judge/parse.ts";

/**
 * Reading a proposed policy change out of a model's reply.
 *
 * The discipline here is the same as the judge's: if the proposal cannot be read and
 * checked, it is refused rather than guessed at. One rule matters more than the rest
 * — a change that claims to replace existing policy text must quote text that is
 * actually in the policy. A model that invents the line it is "fixing" produces a
 * confident, plausible, wrong diff, and a person approving it would be editing a
 * document they no longer recognise.
 */
export interface PolicyChange {
  analysis: string;
  /**
   * The exact span of the current policy this replaces, as it appears in the policy —
   * not as the model typed it. Null means the change adds new text instead.
   */
  quotedOld: string | null;
  proposedNew: string;
  risks: string[];
}

export type ParsedChange =
  | { ok: true; change: PolicyChange }
  | { ok: false; reason: string };

/**
 * The shortest quote that can name one place in a policy. "." or "refunds" satisfied "quotes text
 * that is in the policy" and then replaced the first match, which was not the sentence the analysis
 * was about (final audit E-7, 2026-10-28). Twelve characters is a short clause, not a punctuation mark.
 */
export const MIN_QUOTE_CHARS = 12;
/** What a proposal's prose may weigh in storage; the model is asked for two or three sentences. */
const ANALYSIS_MAX = 2000;
const RISKS_MAX = 10;
const RISK_MAX = 300;

/** How many times a span occurs in a text, overlapping occurrences not counted. */
function occurrences(text: string, span: string): number {
  if (!span) return 0;
  let n = 0;
  for (let at = text.indexOf(span); at !== -1; at = text.indexOf(span, at + span.length)) n++;
  return n;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Finds a quoted passage in the policy and returns the policy's own wording of it.
 *
 * Models reflow whitespace when they quote — a line break becomes a space, an indent
 * disappears. Tolerating that is not the same as tolerating invention: the match is
 * still anchored to every non-whitespace character, in order, and what comes back is
 * the real substring so the replacement lands on real text.
 */
export function locateQuote(policyBody: string, quote: string): string | null {
  const trimmed = quote.trim();
  if (!trimmed) return null;
  if (policyBody.includes(trimmed)) return trimmed;

  const pattern = trimmed
    .split(/\s+/)
    .map(escapeRegExp)
    .join("\\s+");

  const match = new RegExp(pattern).exec(policyBody);
  return match ? match[0] : null;
}

export function parsePolicyChange(text: string, policyBody: string): ParsedChange {
  const parsed = extractJsonObject(text) as Record<string, unknown> | null;
  if (!parsed) return { ok: false, reason: "The model did not return a readable proposal." };

  const analysis = typeof parsed.analysis === "string" ? parsed.analysis.trim().slice(0, ANALYSIS_MAX) : "";
  if (!analysis) return { ok: false, reason: "The proposal came back with no explanation." };

  const proposedNew = typeof parsed.proposed_new === "string" ? parsed.proposed_new.trim() : "";
  if (!proposedNew) return { ok: false, reason: "The proposal came back with no replacement text." };

  const kind = String(parsed.change ?? "").trim().toLowerCase();
  if (kind !== "replace" && kind !== "add") {
    return { ok: false, reason: 'The proposal did not say whether it replaces or adds text.' };
  }

  const risks = Array.isArray(parsed.risks)
    ? parsed.risks.filter((r): r is string => typeof r === "string" && r.trim().length > 0).map((r) => r.trim().slice(0, RISK_MAX)).slice(0, RISKS_MAX)
    : [];

  if (kind === "add") {
    return { ok: true, change: { analysis, quotedOld: null, proposedNew, risks } };
  }

  const claimed = typeof parsed.quoted_old === "string" ? parsed.quoted_old : "";
  if (!claimed.trim()) {
    return { ok: false, reason: "The proposal said it replaces text but quoted none." };
  }

  const located = locateQuote(policyBody, claimed);
  if (!located) {
    return {
      ok: false,
      reason: "The proposal quoted policy text that is not in this policy version, so it was refused.",
    };
  }

  // A quote that cannot name one place is refused rather than applied to the first match, the same
  // rule as a target that moved: "applied nearby" and "applied to the first of several" are one failure.
  if (located.replace(/\s+/g, " ").length < MIN_QUOTE_CHARS) {
    return { ok: false, reason: "The proposal quoted too little of the policy to say which passage it replaces, so it was refused." };
  }
  if (occurrences(policyBody, located) > 1) {
    return { ok: false, reason: "The proposal quoted text that appears more than once in this policy, so it could not say which passage it replaces and was refused." };
  }

  if (located === proposedNew) {
    return { ok: false, reason: "The proposal replaces the text with itself." };
  }

  return { ok: true, change: { analysis, quotedOld: located, proposedNew, risks } };
}

/**
 * Applies an approved change to a policy body.
 *
 * Returns null when the quoted text is no longer present — which happens whenever
 * another change was approved first. The caller must treat that as a refusal, not
 * patch something adjacent: a stale diff applied to a moved target is exactly the
 * silent corruption this whole module exists to prevent.
 */
export function applyPolicyChange(policyBody: string, change: PolicyChange): string | null {
  if (change.quotedOld === null) {
    return `${policyBody.trimEnd()}\n\n${change.proposedNew}\n`;
  }
  // Absent, or no longer one place (another approved change may have repeated the text): refused.
  if (occurrences(policyBody, change.quotedOld) !== 1) return null;
  // Spliced by position, not `String.replace(string, string)`, which reads `$'`, `` $` `` and `$&` in
  // the replacement and wrote a different policy than the one shown (final audit E-6, 2026-10-28).
  const at = policyBody.indexOf(change.quotedOld);
  return policyBody.slice(0, at) + change.proposedNew + policyBody.slice(at + change.quotedOld.length);
}
