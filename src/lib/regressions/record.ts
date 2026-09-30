import type { SupabaseClient } from "@supabase/supabase-js";
import { redactForStorage } from "../redact/store.ts";
import { SEVERITIES } from "../suites/validate.ts";
import type { SuiteCase } from "../runner/types.ts";
import { regressionScenario } from "./draft.ts";

/**
 * Records a failure seen in production and drafts it as a regression scenario — the one
 * path for the form on /regressions and for `POST /api/v1/production-failures`, so the
 * two cannot drift apart on what is redacted, what is kept, or how a draft is built.
 *
 * Everything the caller sent is redacted before anything is stored; the original is kept
 * only as a hash (0031). No model is asked: the scenario's input is the customer's
 * redacted message and its expectation is the caller's own sentence. The draft waits for
 * the same named approval as every other draft.
 *
 * The same text sent again — an automation retrying — is recognised by that hash and
 * answered with the first record rather than a second draft (0044, unique).
 */

export const FAILURE_LIMITS = { customerMessage: 4000, agentReply: 8000, expectedBehavior: 1000, whatWentWrong: 1000 } as const;

export interface ProductionFailureInput {
  customerMessage: string;
  agentReply?: string;
  expectedBehavior: string;
  whatWentWrong?: string;
  obligation: string;
  severity: string;
  agentId?: string | null;
  /** `YYYY-MM-DD`. */
  occurredOn?: string | null;
}

export type FailureField = keyof typeof FAILURE_LIMITS | "obligation" | "severity" | "occurredOn";

/** Which field is wrong and how. Each caller words it for its own reader. */
export type FailureProblem =
  | { field: "customerMessage" | "expectedBehavior"; problem: "required" }
  | { field: keyof typeof FAILURE_LIMITS; problem: "too_long"; limit: number }
  | { field: "obligation" | "severity" | "occurredOn"; problem: "invalid" };

export function checkFailure(input: ProductionFailureInput): FailureProblem | null {
  if (!input.customerMessage.trim()) return { field: "customerMessage", problem: "required" };
  if (!input.expectedBehavior.trim()) return { field: "expectedBehavior", problem: "required" };
  for (const [field, limit] of Object.entries(FAILURE_LIMITS) as Array<[keyof typeof FAILURE_LIMITS, number]>) {
    if ((input[field] ?? "").length > limit) return { field, problem: "too_long", limit };
  }
  if (!/^[a-z][a-z0-9_]{2,60}$/.test(input.obligation)) return { field: "obligation", problem: "invalid" };
  if (!SEVERITIES.includes(input.severity as (typeof SEVERITIES)[number])) return { field: "severity", problem: "invalid" };
  if (input.occurredOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn)) return { field: "occurredOn", problem: "invalid" };
  return null;
}

export type RecordedFailure =
  | {
      ok: true;
      /** True when this exact text was already recorded; the ids are the first record's. */
      duplicate: boolean;
      failureId: string;
      draftId: string | null;
      scenarioId: string | null;
      /** What redaction removed, by kind: `{ EMAIL: 2 }`. */
      removed: Record<string, number>;
    }
  | { ok: false; kind: "invalid"; problem: FailureProblem }
  | { ok: false; kind: "unknown_agent" | "draft_invalid" | "storage"; error: string };

export async function recordProductionFailure(args: {
  db: SupabaseClient;
  workspaceId: string;
  /** The person responsible: whoever used the form, or the key's creator. */
  userId: string | null;
  /** The key that sent it, when a pipeline did. */
  apiKeyId?: string | null;
  input: ProductionFailureInput;
}): Promise<RecordedFailure> {
  const { db, workspaceId, input } = args;
  const clean = {
    ...input,
    customerMessage: input.customerMessage.trim(),
    agentReply: (input.agentReply ?? "").trim(),
    expectedBehavior: input.expectedBehavior.trim(),
    whatWentWrong: (input.whatWentWrong ?? "").trim(),
  };
  const problem = checkFailure(clean);
  if (problem) return { ok: false, kind: "invalid", problem };

  if (clean.agentId) {
    const { data: agent } = await db.from("agents").select("id").eq("id", clean.agentId).eq("workspace_id", workspaceId).maybeSingle();
    if (!agent) return { ok: false, kind: "unknown_agent", error: "That agent could not be found in this workspace." };
  }

  // Everything the caller typed is redacted, not only the customer's message: an
  // expectation often quotes the details it is about.
  const { fields, record } = redactForStorage({
    customer_message: clean.customerMessage,
    agent_reply: clean.agentReply,
    expected_behavior: clean.expectedBehavior,
    what_went_wrong: clean.whatWentWrong,
  });

  const existing = async (): Promise<RecordedFailure | null> => {
    const { data: first } = await db.from("production_failures").select("id")
      .eq("workspace_id", workspaceId).eq("redaction->>original_hash", record.original_hash).maybeSingle();
    if (!first) return null;
    const { data: draft } = await db.from("scenario_drafts").select("id, scenario")
      .eq("production_failure_id", first.id).order("created_at").limit(1).maybeSingle();
    return {
      ok: true, duplicate: true, failureId: first.id as string, draftId: (draft?.id as string | undefined) ?? null,
      scenarioId: ((draft?.scenario as SuiteCase | undefined)?.id) ?? null, removed: record.counts,
    };
  };
  const already = await existing();
  if (already) return already;

  const { data: drafts } = await db.from("scenario_drafts").select("scenario").eq("workspace_id", workspaceId);
  const usedIds = (drafts ?? []).map((row) => (row.scenario as SuiteCase)?.id).filter(Boolean) as string[];
  const built = regressionScenario({
    customerMessage: fields.customer_message,
    expectedBehavior: fields.expected_behavior,
    whatWentWrong: fields.what_went_wrong || null,
    obligation: clean.obligation,
    severity: clean.severity,
  }, usedIds);
  if (!built.ok) return { ok: false, kind: "draft_invalid", error: built.errors.join(" ") };

  const { data: failure, error: failureError } = await db.from("production_failures").insert({
    workspace_id: workspaceId,
    agent_id: clean.agentId || null,
    customer_message: fields.customer_message,
    agent_reply: fields.agent_reply || null,
    expected_behavior: fields.expected_behavior,
    what_went_wrong: fields.what_went_wrong || null,
    occurred_on: clean.occurredOn || null,
    redaction: record,
    created_by: args.userId,
    api_key_id: args.apiKeyId ?? null,
  }).select("id").single();
  if (failureError || !failure) {
    // Lost a race with an identical request: answer with the record that won.
    if (failureError?.code === "23505") {
      const won = await existing();
      if (won) return won;
    }
    return { ok: false, kind: "storage", error: `The failure could not be recorded: ${failureError?.message ?? "no row returned"}` };
  }

  const { data: draft, error: draftError } = await db.from("scenario_drafts").insert({
    workspace_id: workspaceId,
    agent_id: clean.agentId || null,
    origin: "production",
    production_failure_id: failure.id,
    scenario: built.scenario,
    duty_refs: [],
    risk_level: clean.severity === "critical" || clean.severity === "high" ? "high" : clean.severity === "low" ? "low" : "medium",
    created_by: args.userId,
    api_key_id: args.apiKeyId ?? null,
  }).select("id").single();
  if (draftError || !draft) {
    return { ok: false, kind: "storage", error: `The failure was recorded, but its draft could not be saved: ${draftError?.message ?? "no row returned"}` };
  }

  return { ok: true, duplicate: false, failureId: failure.id as string, draftId: draft.id as string, scenarioId: built.scenario.id, removed: record.counts };
}
