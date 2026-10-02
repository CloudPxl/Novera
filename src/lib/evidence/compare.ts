import type { CaseStatus } from "./coverage.ts";

/**
 * Baseline comparison. Nate's rule, kept literally: a rerun has to show what got
 * fixed, what stayed broken, AND what the change broke. Reporting only the first two
 * is how a policy edit quietly makes an agent worse.
 */
export interface ComparableCase {
  caseId: string;
  status: CaseStatus;
}

export interface Comparison {
  fixed: string[];
  persistentFailures: string[];
  newFailures: string[];
  nowErrored: string[];
  errorResolved: string[];
  /** Present in the current run but absent from the baseline — the suite changed. */
  notInBaseline: string[];
  /** In the baseline but missing from the current run — coverage was lost. */
  missingFromCurrent: string[];
  comparable: boolean;
}

export function compareRuns(baseline: ComparableCase[], current: ComparableCase[]): Comparison {
  const before = new Map(baseline.map((c) => [c.caseId, c.status]));
  const after = new Map(current.map((c) => [c.caseId, c.status]));

  const fixed: string[] = [];
  const persistentFailures: string[] = [];
  const newFailures: string[] = [];
  const nowErrored: string[] = [];
  const errorResolved: string[] = [];
  const notInBaseline: string[] = [];

  for (const [caseId, now] of after) {
    const then = before.get(caseId);
    if (then === undefined) {
      notInBaseline.push(caseId);
      continue;
    }
    if (then !== "pass" && now === "pass") fixed.push(caseId);
    if (then === "fail" && now === "fail") persistentFailures.push(caseId);
    if (then === "pass" && now === "fail") newFailures.push(caseId);
    if (then !== "error" && now === "error") nowErrored.push(caseId);
    if (then === "error" && now !== "error") errorResolved.push(caseId);
  }

  const missingFromCurrent = [...before.keys()].filter((id) => !after.has(id));

  return {
    fixed: fixed.sort(),
    persistentFailures: persistentFailures.sort(),
    newFailures: newFailures.sort(),
    nowErrored: nowErrored.sort(),
    errorResolved: errorResolved.sort(),
    notInBaseline: notInBaseline.sort(),
    missingFromCurrent: missingFromCurrent.sort(),
    // Two runs over different case sets can still be shown, but the diff is partial
    // and the report has to say so.
    comparable: notInBaseline.length === 0 && missingFromCurrent.length === 0,
  };
}

/**
 * Why one scenario's verdict moved between two runs, from what both stored.
 *
 * A moved verdict is not an agent change until the evidence says so. The reply's SHA-256
 * is stamped on every row by the database (0037, over the reply, the transcript and the
 * tool activity), so two runs can be compared without either reply still being held:
 * identical fingerprints with a different verdict are the graders moving, never the agent
 * improving or regressing. A read-back that answered before and not now is its own cause,
 * and a run with no reply for the scenario cannot say what the agent did at all.
 */
export type MoveCause = "agent_changed" | "graders_changed" | "readback_unavailable" | "no_reply" | "unknown";

export interface MovedEvidence {
  status: CaseStatus;
  replySha: string | null;
  replied: boolean;
  observation: string | null;
}

export const MOVE_SENTENCE: Record<MoveCause, string> = {
  agent_changed: "The agent's reply changed.",
  graders_changed: "The agent's reply was identical; the graders changed.",
  readback_unavailable: "The action could not be independently verified this time.",
  no_reply: "One of the two runs has no reply for it, so what the agent did cannot be compared.",
  unknown: "Whether the reply changed is not known: one of the runs predates reply fingerprints.",
};

export function causeOfMove(before: MovedEvidence, after: MovedEvidence): MoveCause {
  if (after.observation === "unavailable" && before.observation !== "unavailable") return "readback_unavailable";
  if (!before.replied || !after.replied) return "no_reply";
  if (before.replySha && after.replySha) return before.replySha === after.replySha ? "graders_changed" : "agent_changed";
  return "unknown";
}

/**
 * What else differed between the two runs, from their declared manifests. A policy edit is
 * the usual reason for a rerun and is said plainly; a different rubric, grader plan or way
 * of calling the agent changes what a moved verdict can mean, and is said beside it.
 */
export function contextChanges(
  before: { policyVersion: number | null; manifest: Record<string, unknown> | null },
  after: { policyVersion: number | null; manifest: Record<string, unknown> | null },
): string[] {
  const out: string[] = [];
  if (before.policyVersion !== null && after.policyVersion !== null && before.policyVersion !== after.policyVersion) {
    out.push(`The policy changed: v${before.policyVersion} → v${after.policyVersion}.`);
  }
  const b = before.manifest as { rubric_hash?: string; judge_plan?: Array<{ model: string; task: string }>; agent?: { config_hash?: string }; declared?: { release_id?: string } } | null;
  const a = after.manifest as typeof b;
  if (!b || !a) {
    out.push("One of the runs predates the declared manifest, so only the policy version can be compared.");
    return out;
  }
  if (b.rubric_hash && a.rubric_hash && b.rubric_hash !== a.rubric_hash) out.push("The grading instructions changed between the runs; a moved verdict may be the rubric, not the agent.");
  const plan = (m: typeof b) => (m?.judge_plan ?? []).filter((j) => j.task === "judge" || !j.task).map((j) => j.model).join(", ");
  if (plan(b) && plan(a) && plan(b) !== plan(a)) out.push(`The graders differed: ${plan(b)} → ${plan(a)}.`);
  if (b.agent?.config_hash && a.agent?.config_hash && b.agent.config_hash !== a.agent.config_hash) out.push("The way Novera calls the agent changed (endpoint, template or response path).");
  if (b.declared?.release_id !== a.declared?.release_id && (b.declared?.release_id || a.declared?.release_id)) {
    out.push(`The declared release changed: ${b.declared?.release_id ?? "none"} → ${a.declared?.release_id ?? "none"}.`);
  }
  return out;
}
