import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRoutedChat, type RoutedChat, type RoutedAttempt } from "../router/execute.ts";
import { connectionsForWorkspace } from "./workspace-connections.ts";

/**
 * The model behind a workspace's own work — diagnosing a failure, drafting scenarios from its
 * policy, reading a Suite Builder source, answering in Ask Novera — and the record of each call.
 *
 * One resolution for all of it, the same one grading uses: a workspace with its own key is
 * served on that key alone; one without is served on the trial allowance. Diagnosis, drafting
 * and extraction used to reach for Novera's keys unconditionally, so a workspace that had chosen
 * its own provider had its policy and documents sent to ours (app-wide audit, 2026-10-08). There
 * is no fallback from a workspace key to ours: when the key fails, the operation fails and says so.
 */
export type Funding = "trial_free" | "workspace_key";
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

/** The chat a workspace's model work runs on, or the sentence saying why there is none. */
export async function workspaceChat(args: { client: SupabaseClient; workspaceId: string }): Promise<WorkspaceChat | { error: string }> {
  try {
    const { connections, routes, source } = await connectionsForWorkspace(args);
    const calls: CallRecord[] = [];
    return { chat: observedChat(createRoutedChat({ connections, routes }), calls), funding: source, calls };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No model is available for this workspace right now." };
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

export function fundingLabel(funding: Funding): string {
  return funding === "workspace_key" ? "your own key" : "the Novera trial allowance";
}
