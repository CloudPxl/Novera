import { extractJsonObject } from "../judge/parse.ts";
import { locateQuote } from "../diagnose/parse.ts";
import { validateSuite } from "../suites/validate.ts";
import type { SuiteCase } from "../runner/types.ts";

/**
 * Reading drafted scenarios out of a model's reply.
 *
 * Two rules do the work here, and both are refusals rather than repairs.
 *
 * A scenario must quote the policy it came from, and that quote must be *in* the
 * policy. This is the same rule that stops a diagnosis inventing the line it is
 * fixing (see `../diagnose/parse.ts`), applied to the input side: a case drafted
 * against a duty the document does not contain is a case nobody can defend when a
 * client asks why it is in their report.
 *
 * And a scenario must survive the same validator the importer and the seeder use. A
 * draft that could never run must not be storable in a shape that looks like one that
 * could — an operator approving it would be approving a number that will never exist.
 */

export interface DraftedScenario {
  /** The policy's own wording of the passage this tests, not the model's paraphrase. */
  quote: string;
  scenario: SuiteCase;
  dutyRefs: string[];
  riskLevel: "low" | "medium" | "high";
  destructive: boolean;
  fixtureOnly: boolean;
}

export interface ParsedDrafts {
  drafts: DraftedScenario[];
  /** Every scenario that was thrown away, and why. Shown to the operator verbatim. */
  refused: Array<{ index: number; reason: string }>;
}

const RISK = new Set(["low", "medium", "high"]);

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
}

/**
 * Case ids are assigned here, never taken from the model.
 *
 * "It is how a finding is named in a report" — which makes it ours to control. A
 * model that reuses an id across two drafting runs would put two different scenarios
 * under one name in a client's document, and the second would look like a regression
 * of the first.
 */
export function nextCaseId(existingIds: Iterable<string>): (offset: number) => string {
  let highest = 0;
  for (const id of existingIds) {
    const match = /^P(\d+)$/.exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return (offset: number) => `P${String(highest + 1 + offset).padStart(2, "0")}`;
}

export function parseDraftedScenarios(args: {
  text: string;
  policyBody: string;
  /** Case ids already in use in this workspace, so a new draft never reuses one. */
  usedIds: Iterable<string>;
}): { ok: true; parsed: ParsedDrafts } | { ok: false; reason: string } {
  const json = extractJsonObject(args.text);
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    // A reply that started well and stopped mid-object ran out of room; one that was
    // never JSON is a different problem. "Unreadable JSON" covers both and helps with
    // neither, and only one of them has something the operator can do about it.
    const truncated = args.text.trim().startsWith("{") && !args.text.trim().endsWith("}");
    return {
      ok: false,
      reason: truncated
        ? "The model ran out of room before it finished the last scenario. Ask for fewer at a time."
        : "The model did not return a readable JSON object.",
    };
  }

  const list = (json as Record<string, unknown>).scenarios;
  if (!Array.isArray(list) || list.length === 0) {
    return { ok: false, reason: "The model returned no scenarios." };
  }

  const assign = nextCaseId(args.usedIds);
  const drafts: DraftedScenario[] = [];
  const refused: ParsedDrafts["refused"] = [];

  list.forEach((raw, index) => {
    const s = (raw ?? null) as Record<string, unknown> | null;
    if (!s || typeof s !== "object" || Array.isArray(s)) {
      refused.push({ index, reason: "Not an object." });
      return;
    }

    // The policy is checked against, not trusted from, the model.
    const quote = typeof s.quote === "string" ? locateQuote(args.policyBody, s.quote) : null;
    if (!quote) {
      refused.push({
        index,
        reason: "The passage it claims to test is not in this policy version, so the scenario has no basis.",
      });
      return;
    }

    // Drafted scenarios are held to a stricter standard than imported ones, because
    // nobody hand-wrote them: a compound assertion is refused here. The judge reports
    // which assertions went unmet, and an assertion carrying two claims collapses that
    // to "something in here failed" — in the one document where a reader most needs to
    // know what.
    const compound = stringList(s.assertions).find((a) => /[.!?]\s+\S/.test(a.trim().replace(/[.!?]+$/, "")));
    if (compound) {
      refused.push({
        index,
        reason: `An assertion carries more than one claim, so a failure could not say which part failed: "${compound.slice(0, 80)}…"`,
      });
      return;
    }

    const id = assign(drafts.length);
    const candidate = {
      id,
      category: typeof s.category === "string" ? s.category.trim() : "",
      obligation: typeof s.obligation === "string" ? s.obligation.trim() : "",
      severity: typeof s.severity === "string" ? s.severity.trim().toLowerCase() : "",
      input: typeof s.input === "string" ? s.input.trim() : "",
      expected_behavior: typeof s.expected_behavior === "string" ? s.expected_behavior.trim() : "",
      assertions: stringList(s.assertions),
      ...(stringList(s.forbidden).length ? { forbidden: stringList(s.forbidden) } : {}),
      ...(Array.isArray(s.checks) && s.checks.length ? { checks: s.checks } : {}),
      ...(s.effect && typeof s.effect === "object" ? { effect: s.effect } : {}),
      ...(stringList(s.duty_refs).length ? { duty_refs: stringList(s.duty_refs) } : {}),
      // On the case, not only on the draft row. The runner reads cases; a flag that
      // lived only on the draft would stop guarding the moment the case was promoted.
      ...(s.destructive === true ? { destructive: true } : {}),
      ...(s.fixture_only === true ? { fixture_only: true } : {}),
    };

    // The same validator the importer and the seeder use. One vocabulary for what a
    // runnable scenario is, whoever wrote it.
    const validated = validateSuite({
      key: "drafted", name: "Drafted scenarios", version: 1, cases: [candidate],
    });
    if (!validated.ok) {
      refused.push({ index, reason: validated.errors.join(" ") });
      return;
    }

    const risk = typeof s.risk_level === "string" ? s.risk_level.trim().toLowerCase() : "medium";

    drafts.push({
      quote,
      scenario: validated.suite.cases[0],
      dutyRefs: stringList(s.duty_refs),
      riskLevel: (RISK.has(risk) ? risk : "medium") as "low" | "medium" | "high",
      destructive: s.destructive === true,
      fixtureOnly: s.fixture_only === true,
    });
  });

  if (drafts.length === 0) {
    return {
      ok: false,
      reason: `No scenario survived checking. ${refused.map((r) => r.reason).join(" ")}`.trim(),
    };
  }

  return { ok: true, parsed: { drafts, refused } };
}
