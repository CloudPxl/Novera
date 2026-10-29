import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentConfig } from "../agents/types.ts";
import { buildAgentAdapter } from "../agents/factory.ts";
import { buildVerifier } from "../evidence/connectors/index.ts";
import { AGENT_PACE_MS, executeRun, type RunSummary } from "../runner/execute.ts";
import type { RunCaseRecord } from "../runner/types.ts";
import { coverage, coverageByObligation, coverageByCategory } from "../evidence/coverage.ts";
import type { Suite } from "../runner/types.ts";
import { supabaseRunStore } from "../store/supabase-run-store.ts";
import { CircuitBreaker, createRoutedChat } from "../router/execute.ts";
import { connectionsForWorkspace } from "../providers/workspace-connections.ts";
import { prepareReport, storeReport, type PreparedReport, type ReportArgs } from "./run.ts";
import { reportEnvironment } from "../agents/environment.ts";
import { declaredLocalisation } from "./localised-run.ts";
import { readBackNotFoundMeans, rubricHash } from "../report/manifest.ts";
import { LeakError } from "../report/redact.ts";
import { serviceClient } from "../supabase/service.ts";

/**
 * What the run names as its funding, as its report states it (0067): a grant to the workspace, a
 * grant to the workspace's owner shared by every workspace they own (0076), or a subscription.
 * Read with the service role: an owner-wide grant is usually held by another of the owner's
 * workspaces. A grant that no longer exists was held elsewhere — one held by the run's own
 * workspace is erased only with the run — so it was the owner's.
 */
async function runFunding(grantId: string | null, subscriptionId: string | null): Promise<"grant" | "owner_grant" | "subscription" | null> {
  if (grantId) {
    const { data, error } = await serviceClient().from("billing_entitlement_grants").select("owner_id").eq("id", grantId).maybeSingle();
    if (error) return "grant";
    return data && !data.owner_id ? "grant" : "owner_grant";
  }
  return subscriptionId ? "subscription" : null;
}

/** Everything a run refers to, read through the run row: what it committed to, not what is current. */
async function loadRunContext(client: SupabaseClient, workspaceId: string, runId: string) {
  // Separate reads rather than one embedded select: without generated database
  // types the embedded form is untyped, and this is easier to follow anyway.
  const { data: run, error } = await client
    .from("runs")
    .select("id, agent_id, policy_id, suite_id, baseline_run_id, judge_source, funded_by_grant, funded_by_subscription, attestation_text, pass_threshold, started_at, finished_at, manifest")
    .eq("id", runId)
    .eq("workspace_id", workspaceId)
    .single();

  if (error || !run) throw new Error(`Run not found: ${error?.message ?? "no such run"}`);

  const [agentRow, policyRow, suiteRow, workspaceRow] = await Promise.all([
    client.from("agents").select("name, config, verification, is_production").eq("id", run.agent_id).single(),
    client.from("policies").select("version, body").eq("id", run.policy_id).single(),
    client.from("suites").select("key, version, name, cases, approval").eq("id", run.suite_id).single(),
    client.from("workspaces").select("name").eq("id", workspaceId).single(),
  ]);

  if (!agentRow.data || !policyRow.data || !suiteRow.data || !workspaceRow.data) {
    throw new Error("The run refers to something that no longer exists.");
  }

  const agent = agentRow.data as { name: string; config: AgentConfig; verification: unknown; is_production: boolean };
  const policy = policyRow.data as { version: number; body: string };
  const stored = suiteRow.data as Suite & { approval?: string };
  // A run in another language sends the variants its manifest declared, and only those: if the
  // variants it would send now are not the ones it declared (a sidecar changed between the two),
  // it stops here rather than send a different test under a declared digest.
  const localisation = declaredLocalisation(run.manifest, stored.cases);
  if (!localisation.ok) throw new Error(localisation.error);
  const suite: Suite = { ...stored, cases: localisation.cases };
  const workspace = workspaceRow.data as { name: string };
  return { run, agent, policy, suite, workspace, exploratory: stored.approval === "exploratory" };
}

type RunContext = Awaited<ReturnType<typeof loadRunContext>>;

/**
 * The report a finished run's stored rows support, built and checked but not stored — or null
 * when the run is not sealed at all: nothing gradable, or an exploratory scan (0056 refuses
 * one regardless; its results stay on the run page, labelled).
 */
async function reportFor(client: SupabaseClient, workspaceId: string, ctx: RunContext, whole: RunSummary, runDate?: string): Promise<PreparedReport | null> {
  const { run, agent, policy, suite, workspace } = ctx;
  // A run with no gradable result is not worth a report; leave it as evidence of the
  // attempt rather than publishing an empty document.
  if (whole.coverage.graded === 0 || ctx.exploratory) return null;

  let baseline: ReportArgs["baseline"];
  if (run.baseline_run_id) {
    const { data: previousCases } = await client
      .from("run_cases").select("case_id, status").eq("run_id", run.baseline_run_id);
    if (previousCases?.length) {
      const { data: previousRun } = await client
        .from("runs").select("policy_id").eq("id", run.baseline_run_id).single();
      const { data: previousPolicy } = previousRun
        ? await client.from("policies").select("version").eq("id", previousRun.policy_id).single()
        : { data: null };
      baseline = {
        runId: run.baseline_run_id,
        policyVersion: previousPolicy?.version ?? 0,
        cases: previousCases.map((c) => ({ caseId: c.case_id, status: c.status })),
      };
    }
  }

  // Measured from the run's own timestamps, so a resumed run reports the wall time
  // the customer actually waited rather than the last slice's duration. A report sealed
  // after the run finished measures to its finish, not to the moment it was sealed.
  const startedAt = run.started_at ? new Date(run.started_at as string).getTime() : null;
  const endedAt = run.finished_at ? new Date(run.finished_at as string).getTime() : Date.now();
  const durationMs = startedAt === null ? null : endedAt - startedAt;

  return prepareReport({
    client, workspaceId, runId: run.id as string, summary: whole,
    passThreshold: (run.pass_threshold as number | null) ?? 80,
    durationMs,
    clientName: workspace.name,
    agentName: agent.name,
    policyVersion: policy.version,
    policyBody: policy.body,
    environment: reportEnvironment(agent.config),
    attestation: run.attestation_text ?? null,
    suite: { key: suite.key, version: suite.version, name: suite.name },
    judgeSource: (run.judge_source as "trial_free" | "workspace_key" | "plan_managed" | null) ?? "trial_free",
    fundedBy: await runFunding(run.funded_by_grant as string | null, run.funded_by_subscription as string | null),
    baseline,
    runDate,
  });
}

/**
 * Loads everything a queued run refers to and executes it, then publishes a report.
 *
 * The run row already names its agent, policy version and suite, so this reads the
 * run rather than taking those as arguments: what gets executed is whatever the run
 * committed to when it was created, not whatever is current now.
 */
export async function startRunExecution(args: {
  client: SupabaseClient;
  workspaceId: string;
  runId: string;
  /** How long this invocation may spend before handing back a resumable result. */
  budgetMs?: number;
  /** The token this slice's claim wrote (0047); fences every write the slice makes. */
  leaseToken?: string;
}): Promise<RunSummary> {
  const { client, workspaceId, runId, budgetMs, leaseToken } = args;
  const deadline = budgetMs === undefined ? undefined : Date.now() + budgetMs;

  const ctx = await loadRunContext(client, workspaceId, runId);
  const { run, agent, policy, suite } = ctx;

  // What an earlier attempt already graded. Cases are never re-sent to the agent:
  // a second verdict over the same scenario would be new evidence replacing old.
  const { data: existing } = await client
    .from("run_cases").select("case_id").eq("run_id", runId);
  const recorded = new Set((existing ?? []).map((c) => c.case_id as string));

  // The rubric was declared with the run (its digest is in the manifest). A deploy that changed
  // the grading instructions between two slices would grade the rest of the run under another
  // rubric than the one it declared, so a run with scenarios still to grade stops here instead,
  // before any is sent, and is never sealed (final audit follow-up 4, 2026-10-29). A run whose
  // manifest records no rubric predates the digest and is left alone.
  const declaredRubric = (run.manifest as { rubric_hash?: unknown } | null)?.rubric_hash;
  if (rubricDrifted(declaredRubric, suite.cases.some((c) => !recorded.has(c.id)))) throw new Error(RUBRIC_CHANGED);

  const adapter = await buildAgentAdapter({
    client, workspaceId, agentId: run.agent_id, config: agent.config,
  });

  // A workspace with its own key grades on that key alone. The run row already
  // recorded which of the two funded it, at the moment it was created.
  const { connections, routes } = await connectionsForWorkspace({ client, workspaceId });
  // One breaker for the slice: a vendor that keeps failing is skipped by the next case
  // instead of being waited on again. The next slice starts with a clean slate.
  const judge = createRoutedChat({ connections, routes, breaker: new CircuitBreaker() });

  // The runner marks a run completed when its last scenario is recorded. That write is held
  // back here until the report is built (final audit C-3, 2026-10-28): marked first, a report
  // that then failed to build left the run completed with no report, and an advance on a
  // completed run did nothing, so nothing ever sealed it. Now the report is built first; only the
  // leak guard, which would refuse the same evidence every time, aborts the run. Any other
  // failure (a read that did not answer) still completes it, and `sealCompletedRun` seals it
  // later. An aborted outcome from the runner is written at once, as before.
  const store = supabaseRunStore(client, workspaceId, { leaseToken });
  let heldCompletion: { status: "completed"; error?: string } | null = null;
  const holdingStore: typeof store = {
    ...store,
    async finishRun(id, outcome) {
      if (outcome.status !== "completed") return store.finishRun(id, outcome);
      heldCompletion = { status: "completed", error: outcome.error };
      return true;
    },
  };
  // Writes the held completion as the runner's `finishRun` would, but keeps the run's lease until
  // the report is stored (follow-up 7): `sealCompletedRun` claims only a free or expired lease,
  // so it can never seal beside the slice that is storing the report, whatever that slice's
  // budget. Returns what the runner would have concluded when the write did not take (a person
  // stopped the run meanwhile, or another slice took it over).
  const sealToken = leaseToken ?? crypto.randomUUID();
  const complete = async (): Promise<RunSummary["status"]> => {
    let update = client.from("runs")
      .update({
        status: "completed", finished_at: new Date().toISOString(), error: (heldCompletion as { error?: string } | null)?.error ?? null,
        lease_until: new Date(Date.now() + RESEAL_LEASE_MS).toISOString(), lease_token: sealToken,
      })
      .eq("id", runId).eq("workspace_id", workspaceId).in("status", ["queued", "running"]);
    if (leaseToken) update = update.eq("lease_token", leaseToken);
    const { data, error } = await update.select("id");
    if (error) throw new Error(`Could not finish run: ${error.message}`);
    if ((data ?? []).length === 1) return "completed";
    return store.isStopped && await store.isStopped(runId) ? "aborted" : "incomplete";
  };
  const releaseSealLease = () => client.from("runs").update({ lease_until: null, lease_token: null })
    .eq("id", runId).eq("workspace_id", workspaceId).eq("lease_token", sealToken);

  const summary = await executeRun({
    runId,
    suite,
    agent: adapter,
    policy: policy.body,
    judge,
    store: holdingStore,
    skipCaseIds: [...recorded],
    // Null for every agent without a read-back endpoint, which is the normal case:
    // a scenario expecting a change of state then reports it as unverified rather
    // than passed, which is the honest outcome and always has been.
    verifier: await buildVerifier({
      client, workspaceId, agentId: run.agent_id as string, verification: agent.verification,
      // How a 404 is read was declared with the run, not whatever the setting says now.
      notFoundMeans: readBackNotFoundMeans(run.manifest, agent.verification),
    }),
    // Undefined would be read as production, which is the safe default but not the
    // true one. The column has a value for every agent, so pass it.
    agentIsProduction: agent.is_production !== false,
    deadline,
    paceMs: AGENT_PACE_MS,
  });

  // Out of time, not out of luck: the caller invokes this again and it picks up.
  if (summary.status === "incomplete") return summary;

  // An aborted run is never sealed: stopped by a person (even while this slice was
  // grading, when the status written above did not take), stopped for making no
  // progress, or ended by a failure outside any case. Its cases stay as evidence of
  // the attempt; a report over them would be a report over partial evidence.
  const { data: now } = await client.from("runs").select("status").eq("id", runId).eq("workspace_id", workspaceId).single();
  if (now?.status === "aborted" || summary.status === "aborted") return { ...summary, status: "aborted" };

  // Rebuilt from stored rows rather than from this invocation's memory: after a
  // resume, memory holds only the cases this attempt happened to grade.
  const whole = await summaryFromStoredRows({ client, runId, suite, status: summary.status, error: summary.error });

  // Built (and checked) before the run is marked completed; null when it is not sealed at all.
  let prepared: PreparedReport | null = null;
  try {
    prepared = await reportFor(client, workspaceId, ctx, whole);
  } catch (thrown) {
    // The leak guard refuses this evidence every time: the slice's failure path aborts the run
    // with the reason. Anything else may answer next time, and is not worth the run.
    if (thrown instanceof LeakError) throw thrown;
    console.error(`Run ${runId}: the report could not be built now and will be sealed later: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
  }

  const status = await complete();
  if (status !== "completed") {
    return { ...whole, status, ...(status === "incomplete" ? { error: "Another slice took this run over and continues it; this one stopped before sending anything more." } : {}) };
  }
  try {
    // A failure here leaves a completed run without its report; `sealCompletedRun` seals it once
    // this slice's lease is released or has run out.
    if (prepared) await storeReport({ client, workspaceId, runId }, prepared);
  } finally {
    await releaseSealLease();
  }

  return whole;
}

/**
 * How long after a run finished a missing report is taken to be lost rather than on its way:
 * past the 60-second function ceiling, so the slice that finished the run cannot still be
 * about to store it.
 */
export const RESEAL_AFTER_MS = 75_000;
const RESEAL_LEASE_MS = 70_000;

/**
 * Runs finished before this fix shipped are not sealed after the fact (follow-up 5): a report
 * built now would be built by today's code over an old run, and would chain after reports of
 * later runs. Those runs stay as they were — completed, with no report.
 */
export const RESEAL_FROM = "2026-10-29T00:00:00Z";

export const RUBRIC_CHANGED =
  "The grading instructions changed while this run was in progress, so it was stopped rather than graded under two rubrics; rerun it.";

/** Whether a run declared a rubric that is no longer the one in force, with scenarios left to grade. */
export function rubricDrifted(declared: unknown, scenariosLeft: boolean, current = rubricHash()): boolean {
  return scenariosLeft && typeof declared === "string" && declared !== current;
}

/**
 * Seals the report a completed run never got (final audit C-3, 2026-10-28): the slice that
 * completed it failed or was killed between marking it completed and storing the report.
 * From the stored rows, as the slice would have, dated the day the run finished. True when a
 * report was stored.
 *
 * Once only, however many callers arrive: the run's lease is taken on the completed row (a
 * completed run holds none otherwise), the absence of a report is checked again under it, and
 * nothing is attempted until `RESEAL_AFTER_MS` after the finish.
 */
export async function sealCompletedRun(args: { client: SupabaseClient; workspaceId: string; runId: string; now?: number }): Promise<boolean> {
  const { client, workspaceId, runId } = args;
  const now = args.now ?? Date.now();
  const unsealed = async () => {
    const { data } = await client.from("reports").select("id").eq("run_id", runId).eq("workspace_id", workspaceId).limit(1);
    return (data ?? []).length === 0;
  };
  if (!(await unsealed())) return false;

  const { data: row } = await client.from("runs").select("status, finished_at, suites(approval)")
    .eq("id", runId).eq("workspace_id", workspaceId).maybeSingle();
  if (row?.status !== "completed" || !row.finished_at) return false;
  const finishedAt = new Date(row.finished_at as string).getTime();
  if (finishedAt < Date.parse(RESEAL_FROM) || now - finishedAt < RESEAL_AFTER_MS) return false;
  // An exploratory scan is never sealed (0056): known from the suite, before any lease or rebuild,
  // because its run page asks on every load (follow-up 6).
  if ((row.suites as unknown as { approval?: string } | null)?.approval === "exploratory") return false;
  // Nothing graded is never sealed (`reportFor`): said here without taking the lease, because a
  // run page opened on such a run asks on every load.
  const { data: graded } = await client.from("run_cases").select("id").eq("run_id", runId).eq("workspace_id", workspaceId).in("status", ["pass", "fail"]).limit(1);
  if ((graded ?? []).length === 0) return false;

  const token = crypto.randomUUID();
  const { data: claimed } = await client.from("runs")
    .update({ lease_until: new Date(now + RESEAL_LEASE_MS).toISOString(), lease_token: token })
    .eq("id", runId).eq("workspace_id", workspaceId).eq("status", "completed")
    .or(`lease_until.is.null,lease_until.lt.${new Date(now).toISOString()}`)
    .select("id");
  if ((claimed ?? []).length !== 1) return false;

  try {
    if (!(await unsealed())) return false;
    const ctx = await loadRunContext(client, workspaceId, runId);
    const whole = await summaryFromStoredRows({ client, runId, suite: ctx.suite, status: "completed" });
    const prepared = await reportFor(client, workspaceId, ctx, whole, (ctx.run.finished_at as string).slice(0, 10));
    if (!prepared) return false;
    await storeReport({ client, workspaceId, runId }, prepared);
    return true;
  } finally {
    await client.from("runs").update({ lease_until: null, lease_token: null })
      .eq("id", runId).eq("workspace_id", workspaceId).eq("lease_token", token);
  }
}

/**
 * The run as the database holds it.
 *
 * Every figure in a report has to come from stored rows — that is a product rule, and
 * once a run can be executed across more than one invocation it is also the only way
 * to get the right answer.
 */
export async function summaryFromStoredRows(args: {
  client: SupabaseClient;
  runId: string;
  suite: Suite;
  status: RunSummary["status"];
  error?: string;
}): Promise<RunSummary> {
  const { client, runId, suite, status, error } = args;

  const { data: rows } = await client
    .from("run_cases")
    .select("id, case_id, category, obligation, severity, input, expected, assertions, response_text, tool_activity, status, rationale, latency_ms, usage, judge_model, judge_attempts, judge_votes, judge_agreement, failed_assertions, evidence_gap, settled_by, error, transcript")
    .eq("run_id", runId)
    .order("case_id");

  // Observations live in their own table, so a summary rebuilt from stored evidence
  // has to go and get them. Without this a report regenerated later would forget that
  // an effect had been independently confirmed — the one fact this is all for.
  const { data: observations } = await client
    .from("evidence_observations")
    .select("run_case_id, status, detail, connector, connector_version, mode, latency_ms, checked, run_cases!inner(case_id)")
    .in("run_case_id", (rows ?? []).map((r) => r.id as string));

  const observationByCase = new Map<string, RunCaseRecord["observation"]>();
  for (const o of observations ?? []) {
    const caseId = (o.run_cases as { case_id?: string } | null)?.case_id;
    if (!caseId) continue;
    observationByCase.set(caseId, {
      status: o.status as "confirmed" | "contradicted" | "unavailable",
      detail: o.detail as string,
      connector: o.connector as string,
      connectorVersion: o.connector_version as string,
      mode: o.mode as "read_only" | "test_write",
      latencyMs: (o.latency_ms as number | null) ?? 0,
      checked: Array.isArray(o.checked) ? (o.checked as never[]) : [],
    });
  }

  const cases: RunCaseRecord[] = (rows ?? []).map((r) => ({
    runId,
    caseId: r.case_id as string,
    category: r.category as string,
    obligation: r.obligation as string,
    severity: r.severity as string,
    input: r.input as string,
    expected: r.expected as string,
    assertions: Array.isArray(r.assertions) ? (r.assertions as string[]) : [],
    responseText: (r.response_text as string | null) ?? null,
    transcript: Array.isArray(r.transcript) ? (r.transcript as RunCaseRecord["transcript"]) : null,
    toolActivity: r.tool_activity ?? null,
    status: r.status as RunCaseRecord["status"],
    rationale: (r.rationale as string | null) ?? null,
    latencyMs: (r.latency_ms as number | null) ?? 0,
    usage: r.usage ?? null,
    judgeModel: (r.judge_model as string | null) ?? null,
    judgeAttempts: Array.isArray(r.judge_attempts) ? (r.judge_attempts as unknown[]) : [],
    judgeVotes: Array.isArray(r.judge_votes) ? (r.judge_votes as unknown[]) : [],
    judgeAgreement: (r.judge_agreement as string | null) ?? null,
    failedAssertions: Array.isArray(r.failed_assertions) ? (r.failed_assertions as string[]) : [],
    evidenceGap: (r.evidence_gap as RunCaseRecord["evidenceGap"]) ?? null,
    settledBy: (r.settled_by as RunCaseRecord["settledBy"]) ?? null,
    observation: observationByCase.get(r.case_id as string) ?? null,
    error: (r.error as string | null) ?? null,
  }));

  const plannedByObligation: Record<string, number> = {};
  const plannedByCategory: Record<string, number> = {};
  for (const c of suite.cases) {
    plannedByObligation[c.obligation] = (plannedByObligation[c.obligation] ?? 0) + 1;
    plannedByCategory[c.category] = (plannedByCategory[c.category] ?? 0) + 1;
  }

  // Which scenarios asked for proof beyond the agent's words. Read from the suite,
  // not from the stored rows: a case that never ran still counts in the denominator.
  const requiresEvidence = new Set(suite.cases.filter((c) => c.effect).map((c) => c.id));

  return {
    runId,
    status,
    cases,
    coverage: coverage({
      plannedCases: suite.cases.length,
      // Mapped, not spread: the record calls it `judgeAgreement` and coverage calls
      // it `agreement`, and a silent name mismatch here would zero the disputed
      // count without failing anything. The assertion counts are named differently
      // again, because a record's `assertions` is the strings and coverage wants how
      // many of them there are.
      cases: cases.map((c) => ({
        status: c.status,
        error: c.error,
        agreement: c.judgeAgreement,
        evidenceGap: c.evidenceGap,
        assertionCount: c.assertions.length,
        failedAssertionCount: c.failedAssertions.length,
        requiresEvidence: requiresEvidence.has(c.caseId),
        settledBy: c.settledBy,
        observationStatus: c.observation?.status ?? null,
      })),
    }),
    byObligation: coverageByObligation(cases, plannedByObligation),
    byCategory: coverageByCategory(cases, plannedByCategory),
    error,
  };
}
