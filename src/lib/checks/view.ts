import { redact } from "../redact/pii.ts";
import { CHECK_LABEL, checkVerdict, type CheckVerdict, type NoVerdictReason } from "./single.ts";

/**
 * A stored single-scenario check as an API caller reads it.
 *
 * The same rule as `GET /api/v1/runs/{id}` (0050): the agent's own words — its reply, the
 * conversation — are returned only when the key has the `responses` scope *and* the caller asked
 * for them; otherwise personal data a grading model quoted in a reason, or an agent's error
 * repeated, is shown as placeholders, as in a sealed report.
 */

export interface CheckRow {
  id: string;
  origin: string;
  agent_id: string | null;
  case_id: string | null;
  locale: string | null;
  status: string;
  rationale: string | null;
  failed_assertions: unknown;
  evidence_gap: string | null;
  settled_by: string | null;
  judge_votes: unknown;
  judge_agreement: string | null;
  latency_ms: number | null;
  error: string | null;
  judge_source: string | null;
  read_back: { status: string; detail: string; connector: string; mode: string } | null;
  response_text?: string | null;
  transcript?: unknown;
  created_at: string;
}

export interface CheckView {
  id: string;
  origin: string;
  agent_id: string | null;
  suite: string | null;
  scenario_id: string | null;
  locale: string;
  policy_version: number;
  verdict: CheckVerdict;
  no_verdict_reason: NoVerdictReason | null;
  settled_by: string | null;
  agreement: string | null;
  reasons: string[];
  failed_assertions: string[];
  read_back: { status: string; detail: string; connector: string; mode: string } | null;
  graders: Array<{ model: string; verdict: string; read_placeholders: boolean }>;
  graded_on: string | null;
  latency_ms: number | null;
  created_at: string;
  response?: string | null;
  transcript?: unknown;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Who graded, by model and vote — never a vote's own rationale, which may quote the reply. */
function graders(votes: unknown): CheckView["graders"] {
  if (!Array.isArray(votes)) return [];
  return votes
    .filter((v): v is { model: string; status: string; redacted?: boolean } =>
      Boolean(v) && typeof v === "object" && typeof (v as { model?: unknown }).model === "string")
    .map((v) => ({ model: v.model, verdict: v.status === "error" ? "no_result" : String(v.status), read_placeholders: v.redacted === true }));
}

export function checkView(
  row: CheckRow,
  context: { suite: string | null; policyVersion: number; responses: boolean },
): CheckView {
  const quoted = (text: string | null) => (text === null || context.responses ? text : redact(text).text);
  const { verdict, noVerdictReason } = checkVerdict(row);
  const failed = strings(row.failed_assertions).map((a) => quoted(a) as string);
  const rationale = quoted(row.rationale);
  const error = quoted(row.error);
  const reasons = [
    ...(rationale ? [rationale] : []),
    ...(error ? [error] : []),
  ];
  return {
    id: row.id,
    origin: row.origin,
    agent_id: row.agent_id,
    suite: context.suite,
    scenario_id: row.case_id,
    locale: row.locale ?? "en",
    policy_version: context.policyVersion,
    verdict,
    no_verdict_reason: noVerdictReason,
    settled_by: row.settled_by,
    agreement: row.judge_agreement,
    reasons,
    failed_assertions: failed,
    read_back: row.read_back ?? null,
    graders: graders(row.judge_votes),
    graded_on: row.judge_source,
    latency_ms: row.latency_ms,
    created_at: row.created_at,
    ...(context.responses ? { response: row.response_text ?? null, transcript: row.transcript ?? null } : {}),
  };
}

/** The whole 200 answer: the check, the label it is always given, and the limit's state. */
export function checkAnswer(view: CheckView, rateLimit: { remaining: number; resetsAt: string }) {
  return { check: view, label: CHECK_LABEL, rate_limit: { remaining: rateLimit.remaining, resets_at: rateLimit.resetsAt } };
}
