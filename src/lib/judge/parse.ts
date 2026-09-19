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
