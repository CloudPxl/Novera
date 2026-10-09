import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExportSource, Row } from "./workspace.ts";

/**
 * Reads one workspace's rows for an export, with the service role — so every query names the
 * workspace, and no query selects a secret column: no key hash, report token, invitation token
 * hash, webhook secret, sealed credential, agent request configuration beyond what the builder
 * needs for a host, or lease token. The `secrets` table is not read at all.
 *
 * Paged: PostgREST answers at most 1,000 rows a request, and an export that silently stopped at
 * 1,000 cases would be a copy that looks complete and is not.
 */

const PAGE = 1000;
/** A ceiling, not a target: past it the export refuses rather than delivering part of a table. */
const MAX_ROWS_PER_TABLE = 200_000;

async function all(db: SupabaseClient, table: string, columns: string, workspaceId: string, order = "id"): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(columns).eq("workspace_id", workspaceId)
      .order(order, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read ${table}: ${error.message}`);
    rows.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < PAGE) return rows;
    if (rows.length >= MAX_ROWS_PER_TABLE) throw new Error(`${table} has more than ${MAX_ROWS_PER_TABLE} rows; write to support for a bulk export.`);
  }
}

export async function loadExportSource(db: SupabaseClient, workspaceId: string, options: { includeRawEvidence: boolean }): Promise<ExportSource> {
  const raw = options.includeRawEvidence;
  const caseRaw = raw ? ", input, response_text, transcript, tool_activity" : "";
  const retestRaw = raw ? ", response_text, transcript" : "";

  const { data: workspace, error } = await db.from("workspaces")
    .select("id, name, plan, owner_id, created_at, raw_evidence_days").eq("id", workspaceId).maybeSingle();
  if (error || !workspace) throw new Error(`Could not read the workspace: ${error?.message ?? "not found"}`);

  const [
    members, invitations, agents, policies, suites, runs, run_cases, case_retests, verdict_reviews, diagnoses,
    evidence_observations, reports, scenario_drafts, production_failures, run_schedules, webhook_endpoints,
    webhook_deliveries, api_keys, raw_evidence_reads, audit_events, suite_builds, suite_sources, suite_obligations,
  ] = await Promise.all([
    all(db, "workspace_members", "user_id, role, created_at", workspaceId, "user_id"),
    all(db, "workspace_invitations", "id, role, invited_by, created_at, expires_at, accepted_at, accepted_by, revoked_at, revoked_by", workspaceId),
    // `config` is read for its url, kind, provider and model only; the builder keeps nothing else.
    all(db, "agents", "id, name, kind, config, verification, is_production, attested_by, attested_at, attestation_text, created_at", workspaceId),
    all(db, "policies", "id, agent_id, version, body, derived_from, created_by, created_at", workspaceId),
    all(db, "suites", "id, key, version, name, cases, provenance, approval, created_at", workspaceId),
    all(db, "runs", "id, agent_id, policy_id, suite_id, baseline_run_id, status, judge_source, judge_provider, judge_model, agent_model, attestation_text, pass_threshold, manifest, manifest_hash, api_key_id, schedule_id, created_by, stopped_by, created_at, started_at, finished_at, error", workspaceId),
    all(db, "run_cases", `id, run_id, case_id, category, obligation, severity, expected, assertions, status, rationale, error, judge_model, judge_votes, judge_agreement, failed_assertions, evidence_gap, settled_by, latency_ms, usage, created_at, raw_sha256, raw_expired_at${caseRaw}`, workspaceId),
    all(db, "case_retests", `id, run_case_id, policy_id, status, rationale, error, failed_assertions, judge_model, judge_votes, judge_agreement, latency_ms, evidence_gap, settled_by, created_by, created_at, raw_sha256, raw_expired_at${retestRaw}`, workspaceId),
    all(db, "verdict_reviews", "id, run_case_id, reviewer_id, verdict_status, finding, note, created_at", workspaceId),
    all(db, "diagnoses", "id, run_case_id, analysis, quoted_old, proposed_new, risks, status, resulting_policy_id, requested_by, api_key_id, decided_by, decided_at, created_at", workspaceId),
    all(db, "evidence_observations", "id, run_case_id, connector, connector_version, mode, status, detail, checked, latency_ms, created_at", workspaceId),
    all(db, "reports", "id, run_id, content_hash, payload, created_at, expires_at, revoked_at, revoked_by", workspaceId),
    all(db, "scenario_drafts", "id, agent_id, policy_id, origin, status, source_quote, scenario, duty_refs, risk_level, destructive, fixture_only, model, import_provenance, production_failure_id, api_key_id, build_id, source_id, obligation_id, source_ref, conflicts, edited_from, review_note, review_requested_by, approval_group, approved_by, approved_at, rejected_by, rejected_at, rejection_reason, not_applicable_by, not_applicable_at, not_applicable_reason, included_in_suite_id, created_by, created_at", workspaceId),
    all(db, "production_failures", "id, agent_id, customer_message, agent_reply, expected_behavior, what_went_wrong, occurred_on, redaction, created_by, api_key_id, created_at", workspaceId),
    all(db, "run_schedules", "id, agent_id, suite_id, cadence, hour_utc, weekday, next_run_at, paused_at, paused_reason, cancelled_at, cancelled_by, last_attempt_at, last_outcome, created_by, created_at", workspaceId),
    all(db, "webhook_endpoints", "id, url, events, created_by, created_at, revoked_at, revoked_by", workspaceId),
    all(db, "webhook_deliveries", "id, endpoint_id, event, subject_id, status, attempts, last_status, last_error, next_attempt_at, created_at, delivered_at", workspaceId),
    all(db, "api_keys", "id, name, scopes, created_by, created_at, revoked_at, revoked_by", workspaceId),
    all(db, "raw_evidence_reads", "id, run_id, api_key_id, via, read_at", workspaceId),
    all(db, "audit_events", "id, actor_id, subject_user_id, action, detail, created_at", workspaceId),
    all(db, "suite_builds", "id, name, prepared_for, goal, pack_key, pack_version, quick, agent_id, scope, status, gaps_accepted_by, gaps_accepted_at, gaps_accepted_reason, acknowledged_by, acknowledged_at, approved_by, approved_at, published_suite_id, published_by, published_at, abandoned_by, abandoned_at, created_by, created_at", workspaceId),
    all(db, "suite_sources", "id, build_id, kind, title, locator, media_type, original_sha256, byte_size, status, parse_error, text, text_sha256, redaction, authorisation, authorised_by, authorised_at, extracted_parts, content_expired_at, created_by, created_at", workspaceId),
    all(db, "suite_obligations", "id, build_id, source_id, passage, locator, interpretation, obligation, duty_refs, question, suggested_answers, flags, status, answer, answered_by, answered_at, not_applicable_reason, not_applicable_by, not_applicable_at, model, created_by, created_at", workspaceId),
  ]);

  // Current members' sign-in addresses: the owner and admins already see them on the Members page.
  const withEmail = await Promise.all(members.map(async (m) => {
    const { data } = await db.auth.admin.getUserById(m.user_id as string);
    return { ...m, email: data.user?.email ?? null };
  }));

  return {
    workspace: workspace as Row, members: withEmail, invitations, agents, policies, suites, runs, run_cases, case_retests,
    verdict_reviews, diagnoses, evidence_observations, reports, scenario_drafts, production_failures, run_schedules,
    webhook_endpoints, webhook_deliveries, api_keys, raw_evidence_reads, audit_events, suite_builds, suite_sources, suite_obligations,
  };
}
