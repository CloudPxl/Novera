import type { CaseRow } from "./case-table.tsx";

/** What the scenario's own rules found, in the order the runner applies them: before the read-back and the models. */
export function rulesLine(row: Pick<CaseRow, "ruleCount" | "status" | "settledBy">): string {
  const n = row.ruleCount;
  if (n === 0) return "This scenario has no rules of its own.";
  const rules = `${n} ${n === 1 ? "rule" : "rules"}`;
  // A rule can fail a case and never pass one, so a case that went on to the read-back
  // or the models had every rule hold. Anything else — no result, or a row stored
  // before rules existed (0017) — is not evidence either way.
  if (row.status !== "error" && (row.settledBy === "models" || row.settledBy === "read_back")) {
    return `${rules} checked; none was broken.`;
  }
  return `${rules}; no rule finding was recorded.`;
}
