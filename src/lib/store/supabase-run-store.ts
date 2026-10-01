import type { RunCaseRecord, RunStore } from "../runner/types.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * RunStore backed by Supabase.
 *
 * Every write throws on failure rather than swallowing the error: the orchestrator
 * turns that into an aborted run, which is the honest outcome. A run that silently
 * lost half its cases would still produce a confident-looking report.
 */
export function supabaseRunStore(
  client: SupabaseClient,
  workspaceId: string,
  /** The token this slice's claim wrote (0047). Every write below is fenced by it when given. */
  options: { leaseToken?: string } = {},
): RunStore {
  const { leaseToken } = options;
  // Whose lease it is, not whether the run is still going: a person who stops a run keeps
  // the scenarios already sent (they finish and are saved), and that is decided by
  // isStopped, which the runner checks first. Only another slice's token means "not yours".
  async function holds(runId: string): Promise<boolean> {
    if (!leaseToken) return true;
    const { data } = await client.from("runs").select("lease_token").eq("id", runId).eq("workspace_id", workspaceId).maybeSingle();
    return data?.lease_token === leaseToken;
  }
  return {
    holdsRun: holds,

    async markRunning(runId) {
      const { error } = await client
        .from("runs")
        .update({ status: "running" })
        .eq("id", runId)
        .eq("workspace_id", workspaceId)
        // Never revives a run someone stopped, or one already finished.
        .in("status", ["queued", "running"]);
      if (error) throw new Error(`Could not start run: ${error.message}`);
      // Written once. Every slice used to overwrite it, so a resumed run's report
      // measured its duration from the last slice rather than from the start.
      const { error: stamp } = await client
        .from("runs")
        .update({ started_at: new Date().toISOString() })
        .eq("id", runId)
        .eq("workspace_id", workspaceId)
        .is("started_at", null);
      if (stamp) throw new Error(`Could not start run: ${stamp.message}`);
    },

    async saveCase(record: RunCaseRecord) {
      // A slice that lost the run saves nothing: the slice that took it over records its own.
      if (!(await holds(record.runId))) return "not_holder";
      const { data: saved, error } = await client.from("run_cases").insert({
        workspace_id: workspaceId,
        run_id: record.runId,
        case_id: record.caseId,
        category: record.category,
        obligation: record.obligation,
        severity: record.severity,
        input: record.input,
        expected: record.expected,
        assertions: record.assertions,
        response_text: record.responseText,
        transcript: record.transcript ?? null,
        tool_activity: record.toolActivity,
        status: record.status,
        rationale: record.rationale,
        latency_ms: record.latencyMs,
        usage: record.usage,
        // Grading provenance belongs in the row: a report rebuilt from stored
        // evidence must still be able to say which model decided each verdict.
        judge_model: record.judgeModel,
        judge_attempts: record.judgeAttempts,
        judge_votes: record.judgeVotes,
        judge_agreement: record.judgeAgreement,
        failed_assertions: record.failedAssertions,
        evidence_gap: record.evidenceGap,
        settled_by: record.settledBy,
        error: record.error,
      })
        .select("id")
        .single();
      if (error?.code === "23505") {
        // The run already has this scenario — unique on (run_id, case_id), so the row that
        // won is this run's and this case's. Read back to be sure it is there, then treat it
        // as done rather than aborting the run over evidence that exists.
        const { data: existing } = await client.from("run_cases").select("id")
          .eq("run_id", record.runId).eq("case_id", record.caseId).eq("workspace_id", workspaceId).maybeSingle();
        if (existing) return "already_recorded";
      }
      if (error) throw new Error(`Could not save case ${record.caseId}: ${error.message}`);

      // What an independent read of the customer's system showed, if one happened.
      // Its own row rather than a column: an observation has its own provenance —
      // which connector, which version, in which mode, what it looked for — and that
      // is the part a sceptical reader will want to check.
      if (record.observation) {
        const { error: observed } = await client.from("evidence_observations").insert({
          workspace_id: workspaceId,
          run_case_id: saved.id,
          connector: record.observation.connector,
          connector_version: record.observation.connectorVersion,
          mode: record.observation.mode,
          status: record.observation.status,
          detail: record.observation.detail,
          checked: record.observation.checked,
          latency_ms: record.observation.latencyMs,
        });
        // Losing the observation would leave a verdict whose basis cannot be shown,
        // which is worse than losing the case: the case would still claim to be
        // verified. So this fails the save rather than being swallowed.
        if (observed) {
          throw new Error(`Could not save the verification of ${record.caseId}: ${observed.message}`);
        }
      }
      return "saved";
    },

    async isStopped(runId) {
      const { data } = await client.from("runs").select("status").eq("id", runId).eq("workspace_id", workspaceId).maybeSingle();
      return data?.status === "aborted";
    },

    async finishRun(runId, outcome) {
      let update = client
        .from("runs")
        .update({
          status: outcome.status,
          finished_at: new Date().toISOString(),
          error: outcome.error ?? null,
          ...(leaseToken ? { lease_until: null, lease_token: null } : {}),
        })
        .eq("id", runId)
        .eq("workspace_id", workspaceId)
        // A run stopped while this slice was grading stays stopped: its last cases are
        // kept, but it is not turned back into a completed run.
        .in("status", ["queued", "running"]);
      // Only the slice holding the run finishes it.
      if (leaseToken) update = update.eq("lease_token", leaseToken);
      const { data, error } = await update.select("id");
      if (error) throw new Error(`Could not finish run: ${error.message}`);
      return (data ?? []).length === 1;
    },
  };
}
