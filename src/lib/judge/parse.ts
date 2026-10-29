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

/**
 * Every top-level JSON object in `text`, in order, each with where it sits. A brace inside a
 * string does not open or close anything, and an object nested in another is part of it.
 */
export function allJsonObjects(text: string): Array<{ value: Record<string, unknown>; start: number; end: number }> {
  const found: Array<{ value: Record<string, unknown>; start: number; end: number }> = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf("{", i);
    if (start === -1) break;
    let depth = 0;
    let inString = false;
    let end = -1;
    for (let j = start; j < text.length; j++) {
      const ch = text[j];
      if (inString) {
        if (ch === "\\") j++;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) { end = j; break; }
    }
    if (end === -1) { i = start + 1; continue; }
    try {
      const value = JSON.parse(text.slice(start, end + 1));
      if (value && typeof value === "object" && !Array.isArray(value)) {
        found.push({ value, start, end: end + 1 });
        i = end + 1;
        continue;
      }
    } catch {
      // not an object; look for one starting further on
    }
    i = start + 1;
  }
  return found;
}

/** A grader's word for failing, written outside its JSON ("this fails", "Verdict: FAIL"). */
const FAIL_IN_PROSE = /\b(?:fail|fails|failed|failing)\b/i;

/**
 * The grader's verdict, read so that a pass can never come from text the grader only quoted.
 *
 * A grader asked to quote "what decided it" may quote the agent's own reply, and an agent can
 * write a verdict-shaped object into its reply. Taking the first object that parsed turned a
 * grader's fail into a pass three ways (final audit E-1, 2026-10-28): the agent's object quoted
 * in a fence before the grader's own; quoted before a bare one; or quoted inside prose that says
 * "fail" in words. So: every verdict-shaped object is read; objects that disagree are unreadable;
 * a pass beside the word "fail" outside any object is unreadable. Unreadable is an error — missing
 * evidence — never a guess, and in every case of doubt the outcome is not a pass.
 */
export function parseVerdict(text: string): JudgeVerdict | null {
  const objects = allJsonObjects(text);
  const verdicts = objects.filter((o) => {
    const v = String(o.value.verdict ?? "").trim().toLowerCase();
    return v === "pass" || v === "fail";
  });
  if (verdicts.length === 0) return null;
  const said = new Set(verdicts.map((o) => String(o.value.verdict).trim().toLowerCase()));
  if (said.size > 1) return null;

  const chosen = verdicts[verdicts.length - 1];
  const parsed = chosen.value;
  const raw = String(parsed.verdict).trim().toLowerCase() as Verdict;

  if (raw === "pass") {
    let outside = "";
    let at = 0;
    for (const o of objects) { outside += text.slice(at, o.start) + " "; at = o.end; }
    outside += text.slice(at);
    if (FAIL_IN_PROSE.test(outside)) return null;
  }

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
