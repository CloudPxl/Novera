/**
 * Extracting the judge's verdict from its reply.
 *
 * Models wrap JSON in fences, prefix it with prose, or add a closing remark. This
 * recovers the object from all of those. What it deliberately does NOT do is guess:
 * if no valid verdict can be read, the caller records the case as `error` with the
 * raw text preserved. An unreadable verdict is missing evidence, never a pass.
 */
export type Verdict = "pass" | "fail";

export interface JudgeVerdict {
  verdict: Verdict;
  rationale: string;
  failedAssertions: string[];
}

export function extractJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const candidates: string[] = [];

  // ```json ... ``` or bare ``` ... ```
  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    candidates.push(match[1]);
  }
  candidates.push(trimmed);

  // Outermost balanced { ... }, so prose either side is ignored.
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(trimmed.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export function parseVerdict(text: string): JudgeVerdict | null {
  const parsed = extractJsonObject(text) as Record<string, unknown> | null;
  if (!parsed) return null;

  const raw = String(parsed.verdict ?? "").trim().toLowerCase();
  if (raw !== "pass" && raw !== "fail") return null;

  const rationale = typeof parsed.rationale === "string" ? parsed.rationale.trim() : "";
  if (!rationale) return null;

  const failed = Array.isArray(parsed.failed_assertions)
    ? parsed.failed_assertions.filter((a): a is string => typeof a === "string")
    : [];

  return { verdict: raw, rationale, failedAssertions: failed };
}

/**
 * Matching the judge's reported failures back to the suite's own assertions.
 *
 * The prompt numbers the assertions, so models echo them back as `1. <text>` — and
 * the suite stores the bare text. Comparing the two directly never matches, which
 * made every failed case render with a full set of green ticks: the worst possible
 * misreading, since it contradicts the verdict printed beside it.
 *
 * The same rule as the diagnosis path applies here. The judge may not introduce an
 * assertion the suite does not contain, so anything that cannot be resolved to a real
 * assertion is dropped rather than stored. What is stored is always the suite's own
 * wording, so a reader comparing a report to a suite sees identical strings.
 */
function normalise(text: string): string {
  return text
    .replace(/^\s*[-*•]?\s*\d+\s*[.):]\s*/, "") // "1. ", "2) ", "- 3: "
    .replace(/^\s*[-*•]\s*/, "")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/, "")
    .trim()
    .toLowerCase();
}

export function resolveAssertions(assertions: string[], reported: string[]): string[] {
  const canonical = assertions.map((a) => ({ text: a, key: normalise(a) }));
  const hits = new Set<string>();

  for (const raw of reported) {
    // Tried before normalising: "2." normalises to an empty string, because the
    // numbering stripper cannot tell a label from the whole content.
    const index = /^\s*(\d+)\s*[.):]?\s*$/.exec(raw.trim());
    if (index) {
      const byIndex = canonical[Number(index[1]) - 1];
      if (byIndex) hits.add(byIndex.text);
      continue;
    }

    const key = normalise(raw);
    if (!key) continue;

    let match = canonical.find((c) => c.key === key);

    // A judge that paraphrased around the assertion, or quoted part of it. Requires a
    // substantial overlap so a shared stray word cannot pick the wrong assertion.
    if (!match && key.length >= 12) {
      match = canonical.find((c) => c.key.includes(key) || key.includes(c.key));
    }

    if (match) hits.add(match.text);
  }

  // Suite order, not the order the judge happened to list them in.
  return assertions.filter((a) => hits.has(a));
}
