import type { CaseRow } from "./case-table.tsx";

/**
 * Triage over a run's cases: severity counts and the one-line reason a case did not pass.
 *
 * Both are computed from fields already stored on the case row. Nothing here is estimated,
 * and a case whose cause was not recorded (a row from before votes or settled_by existed)
 * gets no reason rather than a guessed one.
 */

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface SeverityCount {
  /** Every scenario of this severity in the run. */
  total: number;
  /** Of those, the ones whose verdict is fail or no result — never counted as passes. */
  notPassed: number;
}

export function severityCounts(cases: Array<Pick<CaseRow, "severity" | "status">>): Record<Severity, SeverityCount> {
  const out = Object.fromEntries(SEVERITIES.map((s) => [s, { total: 0, notPassed: 0 }])) as Record<Severity, SeverityCount>;
  for (const c of cases) {
    const bucket = out[c.severity as Severity];
    if (!bucket) continue;
    bucket.total += 1;
    if (c.status !== "pass") bucket.notPassed += 1;
  }
  return out;
}

/** `?severity=critical,high` → the known severities in it, in scale order; anything else is ignored. */
export function parseSeverities(raw: string | null | undefined): Severity[] {
  const asked = new Set((raw ?? "").split(",").map((s) => s.trim()));
  return SEVERITIES.filter((s) => asked.has(s));
}

/** The value for `?severity=` after toggling one, or null when none is left (drop the parameter). */
export function toggleSeverity(current: Severity[], toggled: Severity): string | null {
  const next = current.includes(toggled) ? current.filter((s) => s !== toggled) : [...current, toggled];
  const ordered = SEVERITIES.filter((s) => next.includes(s));
  return ordered.length ? ordered.join(",") : null;
}

export interface WhyNot {
  label: string;
  tone: "fail" | "error";
}

type WhyInput = Pick<CaseRow, "status" | "settledBy" | "judgeAgreement" | "observation" | "repair">;

/**
 * Why this case is not a pass, in a few words. Null for a pass, and for a failure whose
 * cause was not recorded. The order is strongest evidence first: a contradiction by the
 * customer's own system outranks how many models agreed.
 */
export function whyNotPassed(c: WhyInput): WhyNot | null {
  if (c.status === "pass") return null;
  if (c.status === "error") {
    // The same sentence the case's own "no result" explanation opens with.
    return { label: c.repair?.label ?? "No verdict", tone: "error" };
  }
  if (c.observation?.status === "contradicted") return { label: "Contradicted by read-back", tone: "fail" };
  if (c.settledBy === "deterministic") return { label: "Rule failed", tone: "fail" };
  switch (c.judgeAgreement) {
    case "majority": return { label: "Graders disagreed — settled by a third", tone: "error" };
    case "unconfirmed": return { label: "One grader only", tone: "error" };
    case "agreed": return { label: "Failed by both graders", tone: "fail" };
    default: return null;
  }
}
