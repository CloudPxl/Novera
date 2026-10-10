"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireWorkspace, gate } from "@/lib/auth/session.ts";
import { storeSecret } from "@/lib/store/secrets.ts";
import { probeAgent } from "@/lib/workflow/run.ts";
import { assertPublicUrl, PrivateAddressError } from "@/lib/net/public-url.ts";
import { recordAudit } from "@/lib/audit/record.ts";
import type { HttpAgentConfig } from "@/lib/agents/types.ts";
import {
  archiveConfirmed, changedConnectionFields, nextHttpConfig, parseConnectionEdit, touchesConnection,
} from "@/lib/agents/connection.ts";
import type { FormState } from "./actions.ts";

/**
 * Changing an agent's connection, and archiving or restoring an agent (launch item G1).
 *
 * Every write here goes through the service role after `gate()`: clients write no agents
 * row (0057). 0063 holds the same rules in the database — no archive or connection change
 * while a run of the agent is queued or running, no run or active schedule for an archived
 * agent, no delete — so a refusal here is a sentence and the database is the guarantee.
 *
 * What already happened does not change. A run declares its agent's endpoint host and a
 * digest of the request configuration in its manifest before it executes (0016, frozen),
 * and a sealed report carries its own copy of everything it states; an edit is a new
 * configuration for the next run, never a rewrite of an earlier one.
 */

const IN_FLIGHT = ["queued", "running"] as const;

/** A database refusal from 0063, as the sentence the form shows; anything else unchanged. */
function explainRefusal(message: string): string {
  if (message.includes("agent_busy")) {
    return "A run of this agent is queued or running, and it declared the connection it is using. Wait for it to finish, or stop it, then try again.";
  }
  if (message.includes("agent_archived")) return "This agent is archived. Restore it first.";
  return message;
}

async function inFlightRun(admin: SupabaseClient, workspaceId: string, agentId: string) {
  const { data } = await admin.from("runs").select("id")
    .eq("workspace_id", workspaceId).eq("agent_id", agentId).in("status", [...IN_FLIGHT]).limit(1).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Saves an edited connection, then probes it and keeps the receipt.
 *
 * The credential is write-only: the form never receives it, a new one replaces the stored
 * one (the old is removed after the new is safely stored), and removing it is a choice of
 * its own. The audit line names the fields that changed, never their values.
 */
export async function updateAgentConnection(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  const agentId = String(form.get("agentId") ?? "");

  const gated = await gate(user.id, workspace.id, "agent.write");
  if ("error" in gated) return { error: gated.error };
  const admin = gated.admin;

  const { data: agent } = await admin.from("agents").select("id, name, kind, config, archived_at")
    .eq("id", agentId).eq("workspace_id", workspace.id).maybeSingle();
  if (!agent) return { error: "That agent could not be found in this workspace." };
  if (agent.archived_at) return { error: "This agent is archived. Restore it before changing its connection." };
  const current = agent.config as HttpAgentConfig;
  if (agent.kind !== "http" || current?.kind !== "http") {
    return { error: "Only an HTTP agent's connection can be edited here." };
  }

  const { data: stored } = await admin.from("secrets").select("id")
    .eq("workspace_id", workspace.id).eq("scope", "agent_auth").eq("agent_id", agentId);
  const storedIds = (stored ?? []).map((s) => s.id as string);

  const parsed = parseConnectionEdit({
    name: form.get("name"), url: form.get("url"), bodyTemplate: form.get("bodyTemplate"),
    responsePath: form.get("responsePath"), toolActivityPath: form.get("toolActivityPath"),
    timeoutSeconds: form.get("timeoutSeconds"), authHeaderName: form.get("authHeaderName"),
    credential: form.get("credential"), removeCredential: form.get("removeCredential"),
  }, storedIds.length > 0);
  if (!parsed.ok) return { error: parsed.error };
  const edit = parsed.value;
  if (edit.credential === "remove" && storedIds.length === 0) {
    return { error: "No credential is stored for this agent, so there is nothing to remove." };
  }

  const next = nextHttpConfig(current, edit);
  const changed = changedConnectionFields({ name: agent.name as string, config: current }, { name: edit.name, config: next }, edit.credential);
  if (changed.length === 0) return { notice: "Nothing changed." };

  if (changed.includes("url")) {
    try {
      await assertPublicUrl(next.url);
    } catch (e) {
      return { error: e instanceof PrivateAddressError ? e.message : "That endpoint URL is not valid." };
    }
  }

  // A run reads the connection again on every slice, so a change now would reach the rest
  // of a run that declared the old one. 0063 refuses it regardless; this says it first.
  if (touchesConnection(changed) && await inFlightRun(admin, workspace.id, agentId)) {
    return { error: explainRefusal("agent_busy") };
  }

  const { data: updated, error } = await admin.from("agents").update({ name: edit.name, config: next })
    .eq("id", agentId).eq("workspace_id", workspace.id).is("archived_at", null).select("id").maybeSingle();
  if (error) return { error: `Could not save the connection: ${explainRefusal(error.message)}` };
  if (!updated) return { error: "This agent was archived meanwhile. Restore it first." };

  if (edit.credential === "replace" && edit.newCredential) {
    await storeSecret({ client: admin, workspaceId: workspace.id, scope: "agent_auth", plaintext: edit.newCredential, agentId });
  }
  if (edit.credential !== "keep" && storedIds.length) {
    // After the new one is stored, never before: the adapter reads the newest credential.
    await admin.from("secrets").delete().in("id", storedIds);
  }

  await recordAudit(admin, {
    workspaceId: workspace.id, actorId: user.id, action: "agent.updated",
    detail: { agent: agentId, fields: changed },
  });
  revalidatePath(`/agents/${agentId}`);
  revalidatePath("/agents");

  if (!touchesConnection(changed)) return { notice: "Renamed. Reports already sealed keep the name they were sealed with." };

  const probe = await probeAgent({ client: admin, workspaceId: workspace.id, agentId, config: next });
  return probe.ok
    ? { notice: "Saved, and the agent answered the check. The new receipt is below; the next run uses this connection." }
    : { error: `Saved, but the agent did not answer the check: ${probe.error} The receipt is below. Runs already made are unchanged.` };
}

/**
 * Archives an agent: out of the lists, no new run or schedule, everything it produced kept.
 * Its active schedules are paused with a reason, never cancelled, so a restore can resume
 * them. Refused while a run of it is queued or running.
 */
export async function archiveAgent(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  const agentId = String(form.get("agentId") ?? "");

  const gated = await gate(user.id, workspace.id, "agent.archive");
  if ("error" in gated) return { error: gated.error };
  const admin = gated.admin;

  const { data: agent } = await admin.from("agents").select("id, name, archived_at")
    .eq("id", agentId).eq("workspace_id", workspace.id).maybeSingle();
  if (!agent) return { error: "That agent could not be found in this workspace." };
  if (agent.archived_at) return { notice: "Already archived." };
  if (!archiveConfirmed(agent.name as string, form.get("confirmName"))) {
    return { error: "Type the agent's name exactly to confirm." };
  }
  if (await inFlightRun(admin, workspace.id, agentId)) {
    return { error: "A run of this agent is queued or running. Wait for it to finish, or stop it, then archive." };
  }

  const { data: archived, error } = await admin.from("agents")
    .update({ archived_at: new Date().toISOString(), archived_by: user.id })
    .eq("id", agentId).eq("workspace_id", workspace.id).is("archived_at", null).select("id").maybeSingle();
  if (error) return { error: `Could not archive it: ${explainRefusal(error.message)}` };
  if (!archived) return { notice: "Already archived." };

  const { data: paused, error: pauseError } = await admin.from("run_schedules")
    .update({ paused_at: new Date().toISOString(), paused_reason: "The agent was archived. Restore it, then resume this schedule." })
    .eq("workspace_id", workspace.id).eq("agent_id", agentId).is("paused_at", null).is("cancelled_at", null)
    .select("id");
  const pausedCount = (paused ?? []).length;

  await recordAudit(admin, {
    workspaceId: workspace.id, actorId: user.id, action: "agent.archived",
    detail: { agent: agentId, schedules_paused: pausedCount },
  });
  revalidatePath(`/agents/${agentId}`);
  revalidatePath("/", "layout");

  const schedules = pauseError
    ? ` Its schedules could not be paused (${pauseError.message}); none of them can start a run while it is archived.`
    : pausedCount
      ? ` ${pausedCount === 1 ? "Its schedule was" : `Its ${pausedCount} schedules were`} paused, not cancelled.`
      : "";
  return { notice: `Archived. No new run can start for it; its runs, reports and evidence are kept and still open.${schedules}` };
}

/** Restores an archived agent. Its paused schedules stay paused until someone resumes them. */
export async function restoreAgent(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  const agentId = String(form.get("agentId") ?? "");

  const gated = await gate(user.id, workspace.id, "agent.archive");
  if ("error" in gated) return { error: gated.error };
  const admin = gated.admin;

  const { data: restored, error } = await admin.from("agents")
    .update({ archived_at: null, archived_by: null })
    .eq("id", agentId).eq("workspace_id", workspace.id).not("archived_at", "is", null).select("id").maybeSingle();
  if (error) return { error: `Could not restore it: ${error.message}` };
  if (!restored) return { error: "That agent is not archived in this workspace." };

  const { count } = await admin.from("run_schedules").select("id", { count: "exact", head: true })
    .eq("workspace_id", workspace.id).eq("agent_id", agentId).not("paused_at", "is", null).is("cancelled_at", null);

  await recordAudit(admin, { workspaceId: workspace.id, actorId: user.id, action: "agent.restored", detail: { agent: agentId } });
  revalidatePath(`/agents/${agentId}`);
  revalidatePath("/", "layout");
  return {
    notice: count
      ? `Restored. ${count === 1 ? "Its schedule stays" : `Its ${count} schedules stay`} paused — resume ${count === 1 ? "it" : "each"} on the Schedule tab.`
      : "Restored. Runs can start for it again.",
  };
}
