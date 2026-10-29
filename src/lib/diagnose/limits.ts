/**
 * How much policy text Novera will send to a model in one piece.
 *
 * Diagnosis and drafting send the whole policy. Nothing bounded it: a 1,000,027-character policy
 * was accepted and became one 1 MB drafting request, and diagnosis is served first by the paid
 * vendor, so one free account could spend the month's model budget that every customer's third
 * grading opinion depends on (final audit E-3, 2026-10-28). 60,000 characters is about 15,000 tokens
 * — several times the longest support policy we have seen, and far past the free tiers' per-minute
 * allowance, so a policy this long is a document to excerpt, not a policy to test against.
 * (The Suite Builder reads a longer document, but in 8,000-character parts: `MAX_SOURCE_CHARS`.)
 */
export const POLICY_MAX_CHARS = 60_000;

export function policyTooLong(length: number): string | null {
  if (length <= POLICY_MAX_CHARS) return null;
  return `This policy is ${length.toLocaleString("en")} characters; the limit is ${POLICY_MAX_CHARS.toLocaleString("en")}. A policy is the rules the agent is held to — keep the sections that describe what it may and may not do. For a longer document, use the Suite Builder, which reads it in parts.`;
}
