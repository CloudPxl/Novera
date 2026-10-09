import type { ReportPayload } from "./payload.ts";

const ROLE_WORDS = { first: "first opinion", second: "second opinion", settler: "settled disagreements" } as const;

/**
 * "Graded by", for the report page and every export: each grader and what it did (format 14),
 * or, for a document sealed earlier, the first judges exactly as it recorded them. The line
 * had named one model while a second voted on every model-graded scenario.
 */
export function gradedByLine(run: Pick<ReportPayload["run"], "graders" | "graded_by">): string {
  if (run.graders) {
    if (run.graders.length === 0) return "No model was asked: every scenario was settled by a rule or a read-back.";
    const byModel = new Map<string, string[]>();
    for (const g of run.graders) byModel.set(g.model, [...(byModel.get(g.model) ?? []), `${ROLE_WORDS[g.role]} on ${g.cases}`]);
    return [...byModel].map(([model, roles]) => `${model} (${roles.join(", ")})`).join("; ");
  }
  return run.graded_by?.join(", ") || "not recorded";
}

/**
 * The words before a finding's text. A scenario with no result has no observed behaviour —
 * what it carries is why there is none — on every format; format 14 also says whether the
 * agent ever received it.
 */
export function findingLead(f: Pick<ReportPayload["findings"][number], "outcome" | "no_result">): string {
  if (f.outcome !== "error") return "Observed";
  return f.no_result?.agent_received === "no" ? "Why there is no result (not sent to the agent)" : "Why there is no result";
}
