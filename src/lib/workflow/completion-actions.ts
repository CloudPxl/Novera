"use server";

import { redirect } from "next/navigation";
import { requireWorkspace, gate } from "@/lib/auth/session.ts";
import { remedyFor } from "@/lib/billing/remedy.ts";
import { RunRefusal, startRun } from "./start-run.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCENARIO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export interface CompletionFormState {
  error?: string;
  remedy?: { href: string; label: string };
}

/**
 * "Complete the evidence" (0083): a completion run of the named scenarios, through `startRun` like
 * every run. The scenarios are re-checked on the server (`planCompletion`); the page's list is a
 * request, never trusted.
 */
export async function completeRunEvidence(_prev: CompletionFormState, form: FormData): Promise<CompletionFormState> {
  const { user, workspace } = await requireWorkspace();
  const runId = String(form.get("runId") ?? "").trim();
  if (!UUID.test(runId)) return { error: "No run was named." };
  const scenarioIds = form.getAll("scenarioId").map((v) => String(v).trim()).filter((v) => SCENARIO.test(v)).slice(0, 200);
  if (!scenarioIds.length) return { error: "No scenario was named." };

  const gated = await gate(user.id, workspace.id, "run.start");
  if ("error" in gated) return { error: gated.error };
  const { data: run } = await gated.admin.from("runs").select("agent_id").eq("id", runId).eq("workspace_id", workspace.id).maybeSingle();
  if (!run) return { error: "That run could not be found in this workspace." };

  let started: { id: string };
  try {
    started = await startRun({
      client: gated.admin, workspaceId: workspace.id, userId: user.id, agentId: run.agent_id as string,
      completes: { runId, scenarioIds },
    });
  } catch (e) {
    if (e instanceof RunRefusal) {
      const remedy = remedyFor(e.blocker);
      return { error: e.message, ...(remedy ? { remedy } : {}) };
    }
    return { error: e instanceof Error ? `The completion could not be started: ${e.message}` : "The completion could not be started." };
  }
  redirect(`/runs/${started.id}`);
}
