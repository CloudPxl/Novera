import type { RunCaseRecord, RunStore } from "../runner/types.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * RunStore backed by Supabase.
 *
 * Every write throws on failure rather than swallowing the error: the orchestrator
 * turns that into an aborted run, which is the honest outcome. A run that silently
 * lost half its cases would still produce a confident-looking report.
 */
export function supabaseRunStore(client: SupabaseClient, workspaceId: string): RunStore {
  return {
    async markRunning(runId) {
      const { error } = await client
        .from("runs")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("id", runId)
        .eq("workspace_id", workspaceId);
      if (error) throw new Error(`Could not start run: ${error.message}`);
    },

    async saveCase(record: RunCaseRecord) {
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
    },

    async finishRun(runId, outcome) {
      const { error } = await client
        .from("runs")
        .update({
          status: outcome.status,
          finished_at: new Date().toISOString(),
          error: outcome.error ?? null,
        })
        .eq("id", runId)
        .eq("workspace_id", workspaceId);
      if (error) throw new Error(`Could not finish run: ${error.message}`);
    },
  };
}
