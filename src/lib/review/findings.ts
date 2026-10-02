/**
 * Failed scenarios as findings a person works through — derived, never stored.
 *
 * A failed scenario already lives in two places that cannot drift: its `run_cases` row
 * (append-only) and the suite it came from, which runs it again on every rerun. Copying it
 * into a findings table, or into a "regression draft", would add a third copy that can
 * disagree with the first two — and a regression draft of a suite scenario would run the
 * same case twice and count it twice. So the state of a finding is computed here, from the
 * newest completed run per agent and the previous run of the same suite version:
 *
 *   new            — it passed last time; this run broke it
 *   recurring      — it failed last time too (with how many runs in a row)
 *   not_comparable — no earlier run of this suite version, or no verdict there
 *   resolved       — it failed last time and passes now
 *
 * What a person has done about it comes from its own rows — a proposal, a retest, their
 * own recorded finding — and decides the one next step offered. Nothing here changes a
 * verdict, and nothing is offered that the run page would not offer itself.
 */

export type CaseStatus = "pass" | "fail" | "error";

export interface FindingRun {
  id: string;
  agentId: string;
  agentName: string;
  suiteId: string;
  createdAt: string;
  cases: Map<string, { runCaseId: string; status: CaseStatus; severity: string; obligation: string | null }>;
}

export interface Followup {
  proposal?: "proposed" | "approved" | "rejected";
  retest?: CaseStatus;
  /** A person's own finding beside the verdict (verdict_reviews). */
  finding?: "pass" | "fail";
}

export type FindingState = "new" | "recurring" | "not_comparable" | "resolved";

export interface TestFinding {
  runId: string;
  agentId: string;
  agentName: string;
  caseId: string;
  runCaseId: string;
  severity: string;
  obligation: string | null;
  state: FindingState;
  /** Consecutive comparable runs, newest first, in which it failed (1 = only this one). */
  streak: number;
  previousRunId: string | null;
  followup: Followup;
  next: { label: string; href: string };
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const STATE_ORDER: Record<FindingState, number> = { new: 0, recurring: 1, not_comparable: 2, resolved: 3 };

export const FINDING_STATE_LABEL: Record<FindingState, string> = {
  new: "New since last run",
  recurring: "Recurring",
  not_comparable: "Not comparable",
  resolved: "Resolved",
};

function nextStep(f: Omit<TestFinding, "next">): TestFinding["next"] {
  const at = `/runs/${f.runId}?case=${encodeURIComponent(f.caseId)}`;
  if (f.state === "resolved") return { label: "See it pass", href: at };
  if (f.followup.retest === "pass") return { label: "Retest passed — rerun the suite to confirm", href: `/agents/${f.agentId}` };
  if (f.followup.proposal === "approved") return { label: "Retest against the new policy", href: at };
  if (f.followup.proposal === "proposed") return { label: "Decide the proposed change", href: at };
  if (f.followup.finding) return { label: "Your finding is recorded — open it", href: at };
  return { label: "Inspect and ask why", href: at };
}

/**
 * `runs`: completed runs, newest first, any agents. `followups`: by run_case id, for the
 * newest run's cases. Returns open findings (new, recurring, not comparable) and the
 * resolved ones, most urgent first.
 */
export function testFindings(runs: FindingRun[], followups: Map<string, Followup>): TestFinding[] {
  const byAgent = new Map<string, FindingRun[]>();
  for (const r of runs) byAgent.set(r.agentId, [...(byAgent.get(r.agentId) ?? []), r]);

  const out: TestFinding[] = [];
  for (const agentRuns of byAgent.values()) {
    const [latest, ...older] = agentRuns;
    const comparable = older.filter((r) => r.suiteId === latest.suiteId);
    const previous = comparable[0] ?? null;

    for (const [caseId, c] of latest.cases) {
      const before = previous?.cases.get(caseId);
      if (c.status === "fail") {
        let streak = 1;
        for (const r of comparable) {
          if (r.cases.get(caseId)?.status === "fail") streak++;
          else break;
        }
        const state: FindingState = !before || before.status === "error" ? "not_comparable" : before.status === "pass" ? "new" : "recurring";
        const base = {
          runId: latest.id, agentId: latest.agentId, agentName: latest.agentName, caseId, runCaseId: c.runCaseId,
          severity: c.severity, obligation: c.obligation, state, streak, previousRunId: previous?.id ?? null,
          followup: followups.get(c.runCaseId) ?? {},
        };
        out.push({ ...base, next: nextStep(base) });
      } else if (c.status === "pass" && before?.status === "fail") {
        const base = {
          runId: latest.id, agentId: latest.agentId, agentName: latest.agentName, caseId, runCaseId: c.runCaseId,
          severity: c.severity, obligation: c.obligation, state: "resolved" as const, streak: 0, previousRunId: previous!.id,
          followup: followups.get(c.runCaseId) ?? {},
        };
        out.push({ ...base, next: nextStep(base) });
      }
    }
  }

  return out.sort((a, b) =>
    STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
    (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
    b.streak - a.streak ||
    a.caseId.localeCompare(b.caseId));
}
