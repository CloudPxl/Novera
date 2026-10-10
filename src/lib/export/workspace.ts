import { redact } from "../redact/pii.ts";

/**
 * A copy of everything a workspace holds, as one versioned JSON document.
 *
 * Pure: it takes rows already read and returns the document, so `tests/workspace-export.test.ts`
 * can hand it rows full of secrets and prove none comes out. The loader
 * (`src/lib/export/load.ts`) never selects a secret column in the first place; this function is
 * the second wall. Every table is copied through an allowlist of fields, never `...row`, so a
 * column added to a table later does not leave in an export until someone decides it should.
 *
 * What is never in it, and why, is listed in the document itself (`not_included`).
 *
 * Raw evidence — what the agent replied, whole conversations, tool activity, and the scenario
 * input sent — is included only when the person asked for it, only while the workspace's
 * retention still holds it, and under a `raw_evidence` key that says what it is. Without it,
 * personal data a grading model quoted in a rationale or an error is a placeholder, as in a
 * sealed report and the API's default read (src/lib/api/read.ts).
 */

export const WORKSPACE_EXPORT_FORMAT = "novera.workspace-export.v1";

export type Row = Record<string, unknown>;

export interface ExportSource {
  workspace: Row;
  /** Current members, with the sign-in address of each (null for a pseudonymised account). */
  members: Row[];
  invitations: Row[];
  agents: Row[];
  policies: Row[];
  /** Suites this workspace owns. Built-in suites are named by id in its runs. */
  suites: Row[];
  runs: Row[];
  run_cases: Row[];
  case_retests: Row[];
  verdict_reviews: Row[];
  diagnoses: Row[];
  evidence_observations: Row[];
  reports: Row[];
  scenario_drafts: Row[];
  production_failures: Row[];
  run_schedules: Row[];
  webhook_endpoints: Row[];
  webhook_deliveries: Row[];
  api_keys: Row[];
  raw_evidence_reads: Row[];
  audit_events: Row[];
  suite_builds: Row[];
  suite_sources: Row[];
  suite_obligations: Row[];
}

export interface ExportMeta {
  exportId: string;
  exportedAt: string;
  exportedBy: string;
  includeRawEvidence: boolean;
}

function pick(row: Row, fields: readonly string[]): Row {
  const out: Row = {};
  for (const f of fields) out[f] = row[f] ?? null;
  return out;
}

/** Strings inside a JSON value with personal data replaced by placeholders, structure kept. */
export function redactDeep(value: unknown): unknown {
  if (typeof value === "string") return redact(value).text;
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Row).map(([k, v]) => [k, redactDeep(v)]));
  }
  return value;
}

function hostOf(url: unknown): string | null {
  try {
    return new URL(String(url ?? "")).host || null;
  } catch {
    return null;
  }
}

/** An agent without its connection details: those can carry credentials (headers, body template). */
function agent(a: Row): Row {
  const config = (a.config ?? {}) as Row;
  const verification = a.verification as Row | null | undefined;
  return {
    ...pick(a, ["id", "name", "kind", "is_production", "attested_by", "attested_at", "attestation_text", "created_at", "archived_at", "archived_by"]),
    endpoint: config.kind === "model"
      ? { kind: "model", provider: config.provider ?? null, model: config.model ?? null }
      : { kind: "http", host: hostOf(config.url) },
    read_back: verification ? { kind: verification.kind ?? null, host: hostOf(verification.url) } : null,
  };
}

const RAW_LABEL = "RAW EVIDENCE: the scenario input Novera sent and what the agent returned, exactly as stored. It may contain personal data. Included because the person who requested this export asked for it.";

function rawEvidence(row: Row, fields: readonly string[], include: boolean): Row | undefined {
  if (!include) return undefined;
  if (row.raw_expired_at) {
    return { label: RAW_LABEL, expired: true, note: "Emptied by the workspace's retention period; only the fingerprint (raw_sha256) remains." };
  }
  return { label: RAW_LABEL, expired: false, ...pick(row, fields) };
}

function quoted(text: unknown, raw: boolean): string | null {
  if (text === null || text === undefined) return null;
  return raw ? String(text) : redact(String(text)).text;
}

const CASE_FIELDS = [
  "id", "run_id", "case_id", "category", "obligation", "severity", "expected", "assertions", "status",
  "judge_model", "judge_agreement", "failed_assertions", "evidence_gap", "settled_by", "latency_ms", "usage",
  "created_at", "raw_sha256", "raw_expired_at",
] as const;

function runCase(c: Row, raw: boolean): Row {
  const out: Row = {
    ...pick(c, CASE_FIELDS),
    rationale: quoted(c.rationale, raw),
    error: quoted(c.error, raw),
    judge_votes: c.judge_votes == null ? null : raw ? c.judge_votes : redactDeep(c.judge_votes),
  };
  const evidence = rawEvidence(c, ["input", "response_text", "transcript", "tool_activity"], raw);
  if (evidence) out.raw_evidence = evidence;
  return out;
}

function retest(r: Row, raw: boolean): Row {
  const out: Row = {
    ...pick(r, ["id", "run_case_id", "policy_id", "status", "failed_assertions", "judge_model", "judge_agreement", "latency_ms",
      "evidence_gap", "settled_by", "created_by", "created_at", "raw_sha256", "raw_expired_at"]),
    rationale: quoted(r.rationale, raw),
    error: quoted(r.error, raw),
    judge_votes: r.judge_votes == null ? null : raw ? r.judge_votes : redactDeep(r.judge_votes),
  };
  const evidence = rawEvidence(r, ["response_text", "transcript"], raw);
  if (evidence) out.raw_evidence = evidence;
  return out;
}

/** Why each thing that is not in the file is not, said in the file. */
export const NOT_INCLUDED: ReadonlyArray<{ what: string; why: string }> = [
  { what: "Model API keys, agent credentials, read-back credentials and webhook signing secrets", why: "Secrets. They are encrypted at rest and never leave the server, not even to the workspace's owner. Connect them again wherever you import this." },
  { what: "API key values, their prefixes and their stored HMACs", why: "A key is shown once at creation and only its keyed fingerprint is stored; neither is usable or useful outside Novera. Each key is listed by name, scopes and dates." },
  { what: "Report link tokens", why: "A report's link is a bearer token: whoever holds it reads the report. Each report is included in full, with its content hash, so its integrity can be checked without the link." },
  { what: "Webhook delivery bodies", why: "They carry report links, which are bearer tokens. Each delivery's event, status and attempts are included." },
  { what: "Invitation addresses and invitation token hashes", why: "An address that never became a member is not the workspace's data, and the token hash is a credential. Each invitation's role and dates are included." },
  { what: "Agents' connection configuration: request headers, body template, response paths", why: "Headers and templates can carry credentials. Each agent's host, kind and attestation are included." },
  { what: "Raw evidence past the workspace's retention period", why: "It was emptied by the retention pass and no longer exists anywhere; the verdict and the reply's SHA-256 remain and are included." },
  { what: "Raw evidence, when not requested", why: "The agent's replies, transcripts, tool activity and scenario inputs are included only when the export is requested with them. Without them, personal data a grading model quoted is shown as placeholders, as in a sealed report." },
  { what: "Connection probe responses", why: "A probe's response body is raw agent output kept only for 90 days, and its request can carry the agent's headers." },
  { what: "Assistant conversations and assistant memory", why: "They are private to each person, not to the workspace. Each person exports their own under Settings → Account." },
  { what: "Members' profiles and preferences; former members' addresses", why: "A person's profile is theirs, not the workspace's. Current members are listed with their sign-in address and role; anyone else appears only as an id." },
  { what: "Run leases, lease tokens and internal scheduling state", why: "Operational locks with no meaning outside a running Novera." },
  { what: "Grading attempt logs", why: "Provider-level retries and errors. Each verdict, its votes and who settled it are included." },
  { what: "Built-in suites", why: "They are Novera's, shared by every workspace. Runs name the suite id they used." },
  { what: "Any other workspace's data", why: "An export is of the active workspace only, checked on every query." },
];

export interface WorkspaceExport {
  format: typeof WORKSPACE_EXPORT_FORMAT;
  export_id: string;
  exported_at: string;
  exported_by: string;
  includes_raw_evidence: boolean;
  scope: string;
  workspace: Row;
  counts: Record<string, number>;
  not_included: ReadonlyArray<{ what: string; why: string }>;
  [table: string]: unknown;
}

export function buildWorkspaceExport(src: ExportSource, meta: ExportMeta): WorkspaceExport {
  const raw = meta.includeRawEvidence;
  const tables: Record<string, Row[]> = {
    members: src.members.map((m) => {
      const email = typeof m.email === "string" && !m.email.endsWith("@deleted.invalid") ? m.email : null;
      return { user_id: m.user_id ?? null, role: m.role ?? null, joined_at: m.created_at ?? null, email };
    }),
    invitations: src.invitations.map((i) => pick(i, ["id", "role", "invited_by", "created_at", "expires_at", "accepted_at", "accepted_by", "revoked_at", "revoked_by"])),
    agents: src.agents.map(agent),
    policies: src.policies.map((p) => pick(p, ["id", "agent_id", "version", "body", "derived_from", "created_by", "created_at"])),
    suites: src.suites.map((s) => pick(s, ["id", "key", "version", "name", "cases", "provenance", "approval", "created_at"])),
    runs: src.runs.map((r) => pick(r, [
      "id", "agent_id", "policy_id", "suite_id", "baseline_run_id", "status", "judge_source", "judge_provider", "judge_model",
      "agent_model", "attestation_text", "pass_threshold", "manifest", "manifest_hash", "api_key_id", "schedule_id",
      "created_by", "stopped_by", "created_at", "started_at", "finished_at", "error",
    ])),
    run_cases: src.run_cases.map((c) => runCase(c, raw)),
    case_retests: src.case_retests.map((r) => retest(r, raw)),
    verdict_reviews: src.verdict_reviews.map((v) => pick(v, ["id", "run_case_id", "reviewer_id", "verdict_status", "finding", "note", "created_at"])),
    diagnoses: src.diagnoses.map((d) => pick(d, ["id", "run_case_id", "analysis", "quoted_old", "proposed_new", "risks", "status", "resulting_policy_id", "requested_by", "api_key_id", "decided_by", "decided_at", "created_at"])),
    evidence_observations: src.evidence_observations.map((o) => pick(o, ["id", "run_case_id", "connector", "connector_version", "mode", "status", "detail", "checked", "latency_ms", "created_at"])),
    reports: src.reports.map((r) => ({
      ...pick(r, ["id", "run_id", "content_hash", "created_at", "expires_at", "revoked_at", "revoked_by"]),
      // The sealed document exactly as stored: re-hashing it reproduces content_hash.
      payload: r.payload ?? null,
    })),
    scenario_drafts: src.scenario_drafts.map((d) => pick(d, [
      "id", "agent_id", "policy_id", "origin", "status", "source_quote", "scenario", "duty_refs", "risk_level", "destructive",
      "fixture_only", "model", "import_provenance", "production_failure_id", "api_key_id", "build_id", "source_id",
      "obligation_id", "source_ref", "conflicts", "edited_from", "review_note", "review_requested_by", "approval_group",
      "approved_by", "approved_at", "rejected_by", "rejected_at", "rejection_reason", "not_applicable_by",
      "not_applicable_at", "not_applicable_reason", "included_in_suite_id", "created_by", "created_at",
    ])),
    // Stored redacted (0031); the original exists only as a hash.
    production_failures: src.production_failures.map((f) => pick(f, ["id", "agent_id", "customer_message", "agent_reply", "expected_behavior", "what_went_wrong", "occurred_on", "redaction", "created_by", "api_key_id", "created_at"])),
    run_schedules: src.run_schedules.map((s) => pick(s, ["id", "agent_id", "suite_id", "cadence", "hour_utc", "weekday", "next_run_at", "paused_at", "paused_reason", "cancelled_at", "cancelled_by", "last_attempt_at", "last_outcome", "created_by", "created_at"])),
    webhook_endpoints: src.webhook_endpoints.map((e) => pick(e, ["id", "url", "events", "created_by", "created_at", "revoked_at", "revoked_by"])),
    webhook_deliveries: src.webhook_deliveries.map((d) => pick(d, ["id", "endpoint_id", "event", "subject_id", "status", "attempts", "last_status", "last_error", "next_attempt_at", "created_at", "delivered_at"])),
    api_keys: src.api_keys.map((k) => pick(k, ["id", "name", "scopes", "created_by", "created_at", "revoked_at", "revoked_by"])),
    raw_evidence_reads: src.raw_evidence_reads.map((r) => pick(r, ["id", "run_id", "api_key_id", "via", "read_at"])),
    audit_events: src.audit_events.map((e) => pick(e, ["id", "actor_id", "subject_user_id", "action", "detail", "created_at"])),
    suite_builds: src.suite_builds.map((b) => pick(b, [
      "id", "name", "prepared_for", "goal", "pack_key", "pack_version", "quick", "agent_id", "scope", "status",
      "gaps_accepted_by", "gaps_accepted_at", "gaps_accepted_reason", "acknowledged_by", "acknowledged_at", "approved_by",
      "approved_at", "published_suite_id", "published_by", "published_at", "abandoned_by", "abandoned_at", "created_by", "created_at",
    ])),
    // Stored redacted; the text is emptied 180 days after it arrived (0056).
    suite_sources: src.suite_sources.map((s) => pick(s, [
      "id", "build_id", "kind", "title", "locator", "media_type", "original_sha256", "byte_size", "status", "parse_error",
      "text", "text_sha256", "redaction", "authorisation", "authorised_by", "authorised_at", "extracted_parts",
      "content_expired_at", "created_by", "created_at",
    ])),
    suite_obligations: src.suite_obligations.map((o) => pick(o, [
      "id", "build_id", "source_id", "passage", "locator", "interpretation", "obligation", "duty_refs", "question",
      "suggested_answers", "flags", "status", "answer", "answered_by", "answered_at", "not_applicable_reason",
      "not_applicable_by", "not_applicable_at", "model", "created_by", "created_at",
    ])),
  };

  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
  return {
    format: WORKSPACE_EXPORT_FORMAT,
    export_id: meta.exportId,
    exported_at: meta.exportedAt,
    exported_by: meta.exportedBy,
    includes_raw_evidence: raw,
    scope: "Everything this workspace holds that can leave Novera, as stored, at the moment of export. Novera is evidence of testing, not a legal certification; this file is a copy of that evidence, not a new report.",
    workspace: {
      ...pick(src.workspace, ["id", "name", "plan", "owner_id", "created_at"]),
      retention: { raw_evidence_days: src.workspace.raw_evidence_days ?? null },
    },
    counts,
    ...tables,
    not_included: NOT_INCLUDED,
  };
}

/** The file's bytes: stable two-space JSON with a trailing newline. */
export function serializeExport(doc: WorkspaceExport): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
