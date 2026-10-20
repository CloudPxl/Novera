import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRoutedChat, type RoutedChat, type RoutedAttempt } from "../router/execute.ts";
import { connectionsForWorkspace } from "./workspace-connections.ts";
import { workspaceEntitlement } from "../auth/entitlement.ts";
import type { JudgeSource } from "../billing/entitlement.ts";

/**
 * The model behind a workspace's own work — diagnosing a failure, drafting scenarios from its
 * policy, reading a Suite Builder source, answering in Ask Novera — and the record of each call.
 *
 * One resolution for all of it, the same one grading uses: a workspace with its own key is
 * served on that key alone; one without is served on Novera's keys, funded as its runs are —
 * under a grant or a plan, or on the trial allowance (`modelWorkFunding`, 0076). Diagnosis, drafting
 * and extraction used to reach for Novera's keys unconditionally, so a workspace that had chosen
 * its own provider had its policy and documents sent to ours (app-wide audit, 2026-10-08). There
 * is no fallback from a workspace key to ours: when the key fails, the operation fails and says so.
 */
export type Funding = "trial_free" | "workspace_key" | "plan_managed";
export type ModelOperation = "diagnose" | "draft" | "extract" | "assistant";

export interface CallRecord {
  task: string;
  served_by: string | null;
  attempts: number;
  /** Another candidate answered after one failed or returned something unreadable. */
  fell_back: boolean;
  failures: string[];
}

export interface WorkspaceChat {
  chat: RoutedChat;
  funding: Funding;
  /** Every call made through `chat`, in order, for `recordModelOperation`. */
  calls: CallRecord[];
}

function failuresOf(attempts: RoutedAttempt[]): string[] {
  return attempts
    .filter((a) => !a.ok || a.reason === "invalid_output")
    .map((a) => `${a.connection}/${a.model}: ${a.reason ?? "failed"}`)
    .slice(0, 6);
}

/** Wraps a routed chat so each call is noted — connection, model, attempts — never its content. */
export function observedChat(chat: RoutedChat, calls: CallRecord[]): RoutedChat {
  return (async (task, request) => {
    try {
      const response = await chat(task, request);
      const failures = failuresOf(response.attempts);
      calls.push({
        task,
        served_by: `${response.servedBy.connection}/${response.servedBy.model}`,
        attempts: response.attempts.length,
        fell_back: failures.length > 0,
        failures,
      });
      return response;
    } catch (error) {
      const attempts = (error as { attempts?: RoutedAttempt[] }).attempts ?? [];
      calls.push({ task, served_by: null, attempts: attempts.length, fell_back: false, failures: failuresOf(attempts) });
      throw error;
    }
  }) as RoutedChat;
}

/**
 * Who pays for model work (0076): the workspace's own key when it has one; on Novera's keys,
 * whatever a run started now would be stamped with — `plan_managed` while a grant (a pilot, for
 * one) or a plan funds runs on Novera's keys, the trial allowance otherwise. Pure, so the rule is
 * tested apart from the database.
 */
export function modelWorkFunding(connection: "trial_free" | "workspace_key", runJudgeSource: JudgeSource | null): Funding {
  if (connection === "workspace_key") return "workspace_key";
  return runJudgeSource === "plan_managed" ? "plan_managed" : "trial_free";
}

/**
 * Model work on Novera's shared keys outside runs — diagnosis, drafting, Suite Builder extraction,
 * Ask Novera — per workspace per hour. Runs are counted by their own allowance; this work was
 * recorded but unmetered, so one eager workspace could spend the free-tier quota every pilot shares
 * (Round 2 audit, 2026-10-19). A workspace on its own key is not limited here. Counted in Postgres,
 * like the public forms; when the count cannot be read the work goes ahead.
 */
export const MODEL_WORK_LIMIT = { max: 60, windowSeconds: 60 * 60 };

export function modelWorkRefusal(retryAfterMinutes: number): string {
  const when = retryAfterMinutes <= 1 ? "in a minute" : `in about ${retryAfterMinutes} minutes`;
  return `This workspace has used its ${MODEL_WORK_LIMIT.max} pieces of model work for this hour on Novera's shared models (diagnoses, drafts, extraction and Ask Novera together). It frees up ${when}. A workspace with its own model key (Settings → Grading) is not limited by this.`;
}

/** The chat a workspace's model work runs on, or the sentence saying why there is none. */
export async function workspaceChat(args: { client: SupabaseClient; workspaceId: string }): Promise<WorkspaceChat | { error: string }> {
  try {
    const { connections, routes, source } = await connectionsForWorkspace(args);
    if (source === "trial_free") {
      const { rateLimit } = await import("../support/rate-limit.ts");
      const limit = await rateLimit(`model-work:${args.workspaceId}`, MODEL_WORK_LIMIT, { onError: "allow" });
      if (!limit.allowed) return { error: modelWorkRefusal(limit.retryAfterMinutes) };
    }
    const calls: CallRecord[] = [];
    return { chat: observedChat(createRoutedChat({ connections, routes }), calls), funding: await fundingOf(args, source), calls };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No model is available for this workspace right now." };
  }
}

/**
 * On Novera's keys, the same decision a run start makes (`workspaceEntitlement`). If billing
 * cannot be read, the operation still runs and is recorded as the trial allowance, as before 0076.
 */
async function fundingOf(args: { client: SupabaseClient; workspaceId: string }, connection: "trial_free" | "workspace_key"): Promise<Funding> {
  if (connection === "workspace_key") return "workspace_key";
  try {
    const entitlement = await workspaceEntitlement(args);
    return modelWorkFunding(connection, entitlement.billing.judgeSource);
  } catch {
    return "trial_free";
  }
}

/** One row per operation. A failure to record never fails the operation it describes. */
export async function recordModelOperation(admin: SupabaseClient, row: {
  workspaceId: string;
  operation: ModelOperation;
  funding: Funding;
  outcome: "ok" | "no_usable_output" | "error" | "refused";
  calls: CallRecord[];
  detail?: string | null;
  requestedBy?: string | null;
  apiKeyId?: string | null;
}): Promise<void> {
  const { error } = await admin.from("model_operations").insert({
    workspace_id: row.workspaceId,
    operation: row.operation,
    funded_by: row.funding,
    outcome: row.outcome,
    calls: row.calls.slice(0, 20),
    detail: row.detail ? row.detail.slice(0, 500) : null,
    requested_by: row.requestedBy ?? null,
    api_key_id: row.apiKeyId ?? null,
  });
  if (error) console.error(`[model-work] could not record a ${row.operation} operation: ${error.code ?? ""}`);
}

/**
 * Said beside an answer or a reading: whose key served it. A workspace without its own key is
 * served on Novera's keys whether the trial, a plan or a grant funds its runs, so it is never
 * called "the trial allowance" here — a pilot workspace's Builder readings were.
 */
export function fundingLabel(funding: Funding): string {
  return funding === "workspace_key" ? "your own key" : "Novera's keys";
}
