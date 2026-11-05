import type { ReportRequirements, RequirementLayer } from "./payload.ts";

/**
 * The words every surface uses for a sealed requirements matrix (payload format 16): the report
 * page, the Markdown and CSV exports and the client summary. Article 50 pack, 2026-11-05.
 *
 * Pure and dependency-free, so a server page, an export and a test read one vocabulary. Nothing
 * here is computed from anything but the sealed `requirements` block; a payload without it has
 * no matrix, and no caller renders one.
 *
 * The vocabulary is observation, never conformity: a group is "present in every tested
 * conversation", "deficient in N" or "inconclusive" — never "compliant", never "passed Article
 * 50". Each row is one bounded conversation, and the boundary sentence travels with the matrix.
 */

/** Fixed, and sealed into every format-16 matrix: what the matrix is and is not. */
export const REQUIREMENTS_NOTE =
  "This matrix organises the evidence above by the source of the requirement each scenario observes. It is not a legal conclusion: each row says what the agent did in one bounded conversation, not whether an obligation is met.";

/** Reading order of the five layers, from the law itself to Novera's own observation. */
export const REQUIREMENT_LAYERS: readonly RequirementLayer[] = [
  "binding_legislation",
  "commission_guidance",
  "voluntary_code",
  "customer_policy",
  "novera_scenario",
];

export const REQUIREMENT_LAYER_LABELS: Record<RequirementLayer, string> = {
  binding_legislation: "Binding legislation",
  commission_guidance: "Commission guidance",
  voluntary_code: "Voluntary code",
  customer_policy: "Customer policy",
  novera_scenario: "Novera scenario",
};

export const REQUIREMENT_LAYER_DESCRIPTIONS: Record<RequirementLayer, string> = {
  binding_legislation: "The regulation itself: where the duty comes from.",
  commission_guidance: "How the Commission reads the duty. Guidelines are not binding.",
  voluntary_code: "A code of practice a provider may choose to adhere to. Voluntary.",
  customer_policy: "The operator's own instruction to the agent, by the version this run was given.",
  novera_scenario: "The bounded observation each row is: one scripted conversation, graded on what the agent's replies say, within the scope limit stated beside it.",
};

/** A layer's label, or its code spelled out if a later format names one this build does not know. */
export function layerLabel(layer: string): string {
  return (REQUIREMENT_LAYER_LABELS as Record<string, string>)[layer] ?? layer.replace(/_/g, " ");
}

/** The words for a "not evaluated" item, never a pass, a fail or a gap in a run. */
export const NOT_EVALUATED = "NOT EVALUATED";

type Row = ReportRequirements["rows"][number];
type Group = ReportRequirements["groups"][number];

/** A row's observed outcome: whether the behaviour the scenario requires was observed. */
export function requirementOutcomeWord(row: Pick<Row, "outcome" | "uncorroborated">): string {
  switch (row.outcome) {
    case "pass":
      return row.uncorroborated ? "Observed (one model's verdict, not corroborated)" : "Observed";
    case "fail":
      return "Not observed";
    case "no_result":
      return "No verdict";
    case "not_run":
      return "Not run";
    default:
      return String(row.outcome);
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Why a group without a failure is not "present": every gap, counted. */
function gaps(g: Group): string[] {
  const out: string[] = [];
  if (g.no_result > 0) out.push(`${g.no_result} without a verdict`);
  if (g.not_run > 0) out.push(`${g.not_run} not run`);
  const lone = g.uncorroborated_passes ?? 0;
  if (lone > 0) {
    out.push(`${plural(lone, "pass", "passes")} rest${lone === 1 ? "s" : ""} on one model's verdict, with no second model to corroborate ${lone === 1 ? "it" : "them"}`);
  }
  return out;
}

/** The status alone: "present in every tested conversation (8 of 8)", "deficient in 2 of 8 …", "inconclusive (…)". */
export function groupStatusText(g: Group): string {
  const total = g.passed + g.failed + g.no_result + g.not_run;
  if (g.status === "observed_present") return `present in every tested conversation (${g.passed} of ${total})`;
  if (g.status === "observed_deficient") {
    const rest = gaps({ ...g, uncorroborated_passes: 0 });
    return `deficient in ${g.failed} of ${total} conversations${rest.length ? ` (${rest.join("; ")})` : ""}`;
  }
  const why = gaps(g);
  return `inconclusive (${why.length ? why.join("; ") : "no verdict to read"})`;
}

/** "Observed interaction disclosure (AI Act Art. 50(1) and 50(5)): present in every tested conversation (8 of 8)." */
export function groupStatusSentence(g: Group): string {
  return `${g.label} (${g.refs}): ${groupStatusText(g)}.`;
}

/** The first sentence of a sealed sentence block, for the client summary. */
export function firstSentence(text: string): string {
  const m = /^([\s\S]+?[.!?])(?:\s+(?=[A-Z])|$)/.exec(text.trim());
  return (m ? m[1] : text).trim();
}

/** "Not evaluated: <label> (<refs>) — <short reason>" */
export function notEvaluatedLine(n: ReportRequirements["not_evaluated"][number]): string {
  return `Not evaluated: ${n.label} (${n.refs}) — ${firstSentence(n.reason)}`;
}

/**
 * The client summary's lines for a matrix: each group's status, each item not evaluated, and the
 * boundary's first sentence. Empty for a payload without one.
 */
export function requirementsSummaryLines(req: ReportRequirements | undefined): string[] {
  if (!req) return [];
  return [
    ...req.groups.map(groupStatusSentence),
    ...req.not_evaluated.map(notEvaluatedLine),
    firstSentence(req.boundary),
  ];
}
