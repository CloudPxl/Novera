import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalise, type Json } from "../report/canonical.ts";
import { scenarioDigest } from "../suites/digest.ts";
import type { SuiteCase } from "../runner/types.ts";
import { normaliseTrajectory, type AgentEvent } from "../agents/trajectory.ts";
import { resolveAssertions } from "../judge/parse.ts";
import { noVerdictRow, repairFor } from "./repair.ts";
import { coverage, neverSent, type CaseStatus } from "./coverage.ts";
import { gradeRun, type Grade } from "./grade.ts";
import {
  configurationDiff, medianOf, scenarioDeltas,
  type DeltaRun, type ScenarioDeltas, type ScenarioEvidence,
} from "./compare.ts";

/**
 * Two runs, read once and compared once — for the run page's Comparison tab and for
 * `/runs/compare`, so the two can never disagree about what regressed.
 *
 * Reads through the person's own session client: RLS decides what is visible, and both runs
 * must also be in the active workspace, as on the run page. Four queries for the comparison
 * itself whatever the suite size — the runs, then their suites, policy versions and every
 * scenario row (read-backs embedded) in parallel — plus the seals when the caller shows them.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The database's fingerprint of a row that holds no reply, transcript or tool activity (0037). */
const EMPTY_EVIDENCE_SHA = createHash("sha256").update("\u001f\u001f", "utf8").digest("hex");

const RUN_COLUMNS = "id, workspace_id, status, agent_id, policy_id, suite_id, created_at, started_at, finished_at, pass_threshold, manifest";
const CASE_COLUMNS =
  "id, run_id, case_id, category, obligation, severity, status, input, assertions, failed_assertions, response_text, rationale, error, latency_ms, "
  + "judge_model, judge_agreement, judge_votes, judge_attempts, evidence_gap, settled_by, tool_activity, transcript, raw_expired_at, raw_sha256";

type Row = Record<string, unknown>;

export interface ComparedCase {
  runCaseId: string;
  caseId: string;
  status: CaseStatus;
  severity: string;
  category: string;
  input: string;
  responseText: string | null;
  /** Set once the reply was emptied under the workspace's retention period; the fingerprint stays. */
  rawExpiredAt: string | null;
  rawSha256: string | null;
  /** Agent turns of a conversation, in order; null for a single message. */
  turns: number | null;
  trajectory: AgentEvent[];
  observation: { status: string; detail: string } | null;
  judgeModel: string | null;
  judgeAgreement: string | null;
  judgeVotes: Array<{ model?: unknown; status?: unknown; redacted?: unknown; rationale?: unknown }>;
  settledBy: string | null;
  rationale: string | null;
  failedAssertions: string[];
  error: string | null;
  /** Why there is no verdict, in the run page's words (src/lib/evidence/repair.ts). */
  noResult: string | null;
  latencyMs: number | null;
}

export interface LoadedRun {
  id: string;
  status: string;
  agentId: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  manifest: Record<string, unknown> | null;
  suite: { id: string; key: string; version: number; name: string; owner: string | null; exploratory: boolean };
  policyVersion: number | null;
  cases: Map<string, ComparedCase>;
  /** As the run page's scorecard computes it, from the same rows. */
  grade: Grade;
  medianLatencyMs: number | null;
  /** The newest sealed report, when the caller asked for seals; null when none was sealed. */
  seal?: { contentHash: string; createdAt: string; revokedAt: string | null } | null;
}

export type ComparisonRefusalReason = "missing" | "invalid" | "not_found" | "other_workspace" | "unsettled" | "same_run" | "different_agent" | "different_suite";

export type LoadedComparison =
  | {
      ok: true;
      base: LoadedRun;
      target: LoadedRun;
      deltas: ScenarioDeltas;
      config: ReturnType<typeof configurationDiff>;
    }
  | {
      ok: false;
      reason: ComparisonRefusalReason;
      sentence: string;
      /** The runs that were found, so the explanation can link to them. */
      runs: Array<{ id: string; label: string; workspaceId: string }>;
    };

/** What the caller already read of one run's scenarios, so they are not read twice. */
export interface KnownCases {
  runId: string;
  rows: Row[];
  observations: Array<{ run_case_id: unknown; status: unknown; detail: unknown }>;
}

export function isRunId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export async function loadComparison(args: {
  db: SupabaseClient;
  workspaceId: string;
  baseId: string | null | undefined;
  targetId: string | null | undefined;
  /** Read each run's newest report for its seal (the side-by-side page). */
  seals?: boolean;
  known?: KnownCases;
}): Promise<LoadedComparison> {
  const { db, workspaceId, baseId, targetId } = args;
  if (!baseId || !targetId) {
    return { ok: false, reason: "missing", sentence: "A comparison needs two runs: a base and a target.", runs: [] };
  }
  if (!isRunId(baseId) || !isRunId(targetId)) {
    return { ok: false, reason: "invalid", sentence: "One of the run ids in this address is not a run id.", runs: [] };
  }
  if (baseId === targetId) {
    return { ok: false, reason: "same_run", sentence: "Both sides name the same run. Choose an earlier run of this agent to compare it with.", runs: [] };
  }

  const { data: runRows } = await db.from("runs").select(RUN_COLUMNS).in("id", [baseId, targetId]);
  const runs = (runRows ?? []) as Row[];
  const baseRow = runs.find((r) => r.id === baseId);
  const targetRow = runs.find((r) => r.id === targetId);
  const found = runs.map((r) => ({ id: r.id as string, label: label(r), workspaceId: r.workspace_id as string }));
  if (!baseRow || !targetRow) {
    return { ok: false, reason: "not_found", sentence: `No run with the id ${!baseRow ? baseId : targetId} is visible to you.`, runs: found };
  }
  if (baseRow.workspace_id !== workspaceId || targetRow.workspace_id !== workspaceId) {
    return { ok: false, reason: "other_workspace", sentence: "At least one of these runs belongs to another workspace. A comparison reads only the workspace you are in.", runs: found };
  }
  const unsettled = [baseRow, targetRow].find((r) => r.status !== "completed" && r.status !== "aborted");
  if (unsettled) {
    return { ok: false, reason: "unsettled", sentence: `The run started ${label(unsettled)} has not finished, so its results are not final yet.`, runs: found };
  }

  const known = args.known && (args.known.runId === baseId || args.known.runId === targetId) ? args.known : null;
  const toRead = [baseId, targetId].filter((id) => id !== known?.runId);

  const [{ data: suiteRows }, { data: policyRows }, { data: caseRows }, { data: reportRows }] = await Promise.all([
    db.from("suites").select("id, workspace_id, key, version, name, cases, approval").in("id", [...new Set([baseRow.suite_id, targetRow.suite_id])] as string[]),
    db.from("policies").select("id, version").in("id", [...new Set([baseRow.policy_id, targetRow.policy_id])] as string[]),
    db.from("run_cases").select(`${CASE_COLUMNS}, evidence_observations(status, detail, created_at)`).in("run_id", toRead),
    args.seals
      ? db.from("reports").select("run_id, content_hash, created_at, revoked_at").in("run_id", [baseId, targetId]).order("created_at", { ascending: false })
      : Promise.resolve({ data: null }),
  ]);

  const suiteById = new Map((suiteRows ?? []).map((s) => [s.id as string, s as Row]));
  const versionById = new Map((policyRows ?? []).map((p) => [p.id as string, p.version as number]));
  const rowsByRun = new Map<string, Row[]>([[baseId, []], [targetId, []]]);
  for (const c of (caseRows ?? []) as Row[]) rowsByRun.get(c.run_id as string)?.push(c);
  if (known) {
    const obs = new Map(known.observations.map((o) => [o.run_case_id as string, o]));
    rowsByRun.set(known.runId, known.rows.map((r) => ({ ...r, evidence_observations: obs.has(r.id as string) ? [obs.get(r.id as string)] : [] })));
  }

  const loaded = (row: Row): LoadedRun | null => {
    const suite = suiteById.get(row.suite_id as string);
    if (!suite) return null;
    const scenarios = Array.isArray(suite.cases) ? (suite.cases as SuiteCase[]) : [];
    const rows = rowsByRun.get(row.id as string) ?? [];
    const run: LoadedRun = {
      id: row.id as string,
      status: row.status as string,
      agentId: row.agent_id as string,
      createdAt: row.created_at as string,
      startedAt: (row.started_at as string | null) ?? null,
      finishedAt: (row.finished_at as string | null) ?? null,
      manifest: (row.manifest as Record<string, unknown> | null) ?? null,
      suite: {
        id: suite.id as string, key: suite.key as string, version: suite.version as number, name: suite.name as string,
        owner: (suite.workspace_id as string | null) ?? null, exploratory: suite.approval === "exploratory",
      },
      policyVersion: versionById.get(row.policy_id as string) ?? null,
      cases: new Map(rows.map((c) => [c.case_id as string, comparedCase(c, scenarios.find((s) => s.id === c.case_id) ?? null)])),
      grade: gradeOf(rows, scenarios, (row.pass_threshold as number | null) ?? 80),
      medianLatencyMs: medianOf(rows.filter((c) => !neverSent({ status: c.status as CaseStatus, error: c.error as string | null })).map((c) => c.latency_ms as number | null)),
    };
    if (args.seals) {
      const report = ((reportRows ?? []) as Row[]).find((r) => r.run_id === row.id);
      run.seal = report
        ? { contentHash: report.content_hash as string, createdAt: report.created_at as string, revokedAt: (report.revoked_at as string | null) ?? null }
        : null;
    }
    return run;
  };

  const base = loaded(baseRow);
  const target = loaded(targetRow);
  if (!base || !target) {
    return { ok: false, reason: "not_found", sentence: "The suite one of these runs used could not be read.", runs: found };
  }

  const deltas = scenarioDeltas(deltaRun(base, suiteById.get(baseRow.suite_id as string)!, rowsByRun.get(baseId)!), deltaRun(target, suiteById.get(targetRow.suite_id as string)!, rowsByRun.get(targetId)!));
  if (!deltas.ok) return { ok: false, reason: deltas.reason, sentence: deltas.sentence, runs: found };

  return {
    ok: true,
    base,
    target,
    deltas,
    config: configurationDiff({
      base: { policyVersion: base.policyVersion, manifest: base.manifest, suiteVersion: base.suite.version, medianLatencyMs: base.medianLatencyMs },
      target: { policyVersion: target.policyVersion, manifest: target.manifest, suiteVersion: target.suite.version, medianLatencyMs: target.medianLatencyMs },
      definitions: deltas.definitions,
    }),
  };
}

/** The pure engine's view of a run: its suite's scenarios with their digests, and each row's fingerprints. */
function deltaRun(run: LoadedRun, suite: Row, rows: Row[]): DeltaRun {
  const scenarios = Array.isArray(suite.cases) ? (suite.cases as SuiteCase[]) : [];
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  const cases = new Map<string, ScenarioEvidence>();
  for (const c of rows) cases.set(c.case_id as string, evidenceOf(c, byId.get(c.case_id as string) ?? null));
  return {
    runId: run.id,
    agentId: run.agentId,
    suite: { key: run.suite.key, version: run.suite.version, owner: run.suite.owner },
    scenarios: scenarios.map((s) => ({ id: s.id, digest: scenarioDigest(s), severity: s.severity })),
    cases,
  };
}

/** What the engine compares, from one stored row. Exported for the tests of its edges. */
export function evidenceOf(c: Row, scenario: SuiteCase | null): ScenarioEvidence {
  const expired = Boolean(c.raw_expired_at);
  const rawSha = (c.raw_sha256 as string | null) ?? null;
  const transcript = Array.isArray(c.transcript) ? (c.transcript as Array<Record<string, unknown>>) : null;
  const status = c.status as CaseStatus;
  return {
    status,
    replied: expired
      // An emptied row: a verdict was graded on something, and an errored row held something
      // unless its fingerprint is the empty one.
      ? status !== "error" || (rawSha !== null && rawSha !== EMPTY_EVIDENCE_SHA)
      : Boolean(c.response_text) || Boolean(transcript?.some((t) => t.role === "agent")),
    rawSha,
    contentSha: expired ? null : contentFingerprint(c.response_text, transcript, c.tool_activity),
    conversation: transcript !== null || Boolean(scenario?.earlier_turns?.length) || Boolean(scenario?.persona),
    observation: latestObservation(c)?.status ?? null,
  };
}

/** The reply, the conversation's words and the tool activity — everything 0037 hashes except each turn's timing. */
function contentFingerprint(responseText: unknown, transcript: Array<Record<string, unknown>> | null, toolActivity: unknown): string {
  const words = transcript?.map((turn) => Object.fromEntries(Object.entries(turn).filter(([k]) => k !== "latencyMs"))) ?? null;
  const text = [
    typeof responseText === "string" ? responseText : "",
    words ? canonicalise(words as unknown as Json) : "",
    toolActivity === null || toolActivity === undefined ? "" : canonicalise(toolActivity as Json),
  ].join("\u001f");
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function latestObservation(c: Row): { status: string; detail: string } | null {
  const list = Array.isArray(c.evidence_observations) ? (c.evidence_observations as Row[]) : [];
  const newest = [...list].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0];
  return newest ? { status: newest.status as string, detail: newest.detail as string } : null;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function comparedCase(c: Row, scenario: SuiteCase | null): ComparedCase {
  const transcript = Array.isArray(c.transcript) ? (c.transcript as Array<{ role?: string }>) : null;
  const trajectory = normaliseTrajectory(c.tool_activity);
  const observation = latestObservation(c);
  return {
    runCaseId: c.id as string,
    caseId: c.case_id as string,
    status: c.status as CaseStatus,
    severity: c.severity as string,
    category: c.category as string,
    input: (c.input as string) ?? "",
    responseText: (c.response_text as string | null) ?? null,
    rawExpiredAt: (c.raw_expired_at as string | null) ?? null,
    rawSha256: (c.raw_sha256 as string | null) ?? null,
    turns: transcript ? transcript.filter((t) => t.role === "agent").length : null,
    trajectory,
    observation,
    judgeModel: (c.judge_model as string | null) ?? null,
    judgeAgreement: (c.judge_agreement as string | null) ?? null,
    judgeVotes: Array.isArray(c.judge_votes) ? (c.judge_votes as ComparedCase["judgeVotes"]) : [],
    settledBy: (c.settled_by as string | null) ?? null,
    rationale: (c.rationale as string | null) ?? null,
    // Rows stored before the judge boundary was fixed hold the judge's numbered echo; resolved
    // on the way out, as on the run page.
    failedAssertions: resolveAssertions(strings(c.assertions), strings(c.failed_assertions)),
    error: (c.error as string | null) ?? null,
    noResult: repairFor(noVerdictRow({ ...c, status: c.status }, {
      observationStatus: observation?.status ?? null, scenario, toolCalls: trajectory.filter((e) => e.type === "tool_call").length,
    }))?.label ?? null,
    latencyMs: (c.latency_ms as number | null) ?? null,
  };
}

/** The grade exactly as the run page's scorecard derives it from the same rows (src/app/(app)/runs/[id]/page.tsx). */
function gradeOf(rows: Row[], scenarios: SuiteCase[], threshold: number): Grade {
  const requiresEvidence = new Set(scenarios.filter((s) => s.effect).map((s) => s.id));
  const runCoverage = coverage({
    plannedCases: scenarios.length,
    cases: rows.map((c) => ({
      status: c.status as CaseStatus,
      error: (c.error as string | null) ?? null,
      agreement: (c.judge_agreement as string | null) ?? null,
      evidenceGap: (c.evidence_gap as string | null) ?? null,
      assertionCount: strings(c.assertions).length,
      failedAssertionCount: resolveAssertions(strings(c.assertions), strings(c.failed_assertions)).length,
      requiresEvidence: requiresEvidence.has(c.case_id as string),
      settledBy: (c.settled_by as string | null) ?? null,
    })),
  });
  return gradeRun({ coverage: runCoverage, threshold });
}

function label(r: Row): string {
  return typeof r.created_at === "string" ? `${r.created_at.slice(0, 16).replace("T", " ")} UTC` : "at an unknown time";
}

/**
 * The runs this one can be compared with: the same agent, the same suite key under the same
 * owner at any version, completed — newest first. One query (the suite joined in).
 */
export async function comparableRuns(db: SupabaseClient, run: { id: string; agentId: string }, suite: { key: string; owner: string | null }) {
  let query = db
    .from("runs")
    .select("id, created_at, suite_id, suites!inner(key, version, workspace_id)")
    .eq("agent_id", run.agentId)
    .eq("status", "completed")
    .eq("suites.key", suite.key)
    .neq("id", run.id);
  query = suite.owner === null ? query.is("suites.workspace_id", null) : query.eq("suites.workspace_id", suite.owner);
  const { data } = await query.order("created_at", { ascending: false }).limit(20);
  return ((data ?? []) as Row[]).map((r) => {
    const s = (Array.isArray(r.suites) ? r.suites[0] : r.suites) as { version?: number } | null;
    return { id: r.id as string, createdAt: r.created_at as string, suiteId: r.suite_id as string, suiteVersion: s?.version ?? null };
  });
}

