"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWorkspace, assertMembership } from "@/lib/auth/session.ts";
import { storeSecret } from "@/lib/store/secrets.ts";
import { probeAgent } from "@/lib/workflow/run.ts";
import type { AgentConfig, HttpAgentConfig } from "@/lib/agents/types.ts";

export interface FormState {
  error?: string;
  notice?: string;
}

/**
 * Registers an agent and immediately proves the connection.
 *
 * The attestation is not a checkbox we forget: it is stored on the agent and copied
 * onto every run, so a report can always say on whose authority the agent was tested.
 */
export async function connectAgent(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();

  const name = String(form.get("name") ?? "").trim();
  const url = String(form.get("url") ?? "").trim();
  const responsePath = String(form.get("responsePath") ?? "").trim();
  const bodyTemplateRaw = String(form.get("bodyTemplate") ?? "").trim();
  const toolActivityPath = String(form.get("toolActivityPath") ?? "").trim();
  const authHeaderName = String(form.get("authHeaderName") ?? "").trim();
  const authValue = String(form.get("authValue") ?? "");
  const attested = form.get("attested") === "on";

  if (!name) return { error: "Give the agent a name." };
  if (!url) return { error: "Enter the agent's endpoint URL." };
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
  } catch {
    return { error: "That endpoint URL is not valid." };
  }
  if (!responsePath) return { error: "Tell us where the reply text sits in the response." };
  if (!attested) {
    return { error: "Confirm that you own this agent or are authorised to test it." };
  }

  let bodyTemplate: Record<string, unknown>;
  try {
    bodyTemplate = JSON.parse(bodyTemplateRaw || '{"message":"{{input}}"}');
    if (typeof bodyTemplate !== "object" || Array.isArray(bodyTemplate) || bodyTemplate === null) {
      throw new Error();
    }
  } catch {
    return { error: "The request body must be a JSON object, for example {\"message\": \"{{input}}\"}." };
  }
  if (!JSON.stringify(bodyTemplate).includes("{{input}}")) {
    return { error: "The request body needs {{input}} somewhere, so we know where to put the scenario." };
  }

  const config: HttpAgentConfig = {
    kind: "http",
    url,
    bodyTemplate,
    responsePath,
    ...(toolActivityPath ? { toolActivityPath } : {}),
    ...(authHeaderName ? { authHeaderName } : {}),
  };

  const admin = await assertMembership(user.id, workspace.id);

  const { data: agent, error } = await admin
    .from("agents")
    .insert({
      workspace_id: workspace.id,
      name,
      kind: "http",
      config,
      attested_by: user.id,
      attested_at: new Date().toISOString(),
      attestation_text: `${user.email} confirmed on ${new Date().toISOString().slice(0, 10)} that this agent is owned by their organisation or tested with permission.`,
    })
    .select("id")
    .single();

  if (error) return { error: `Could not save the agent: ${error.message}` };

  if (authValue && authHeaderName) {
    await storeSecret({
      client: admin,
      workspaceId: workspace.id,
      scope: "agent_auth",
      plaintext: authValue,
      agentId: agent.id as string,
    });
  }

  // Prove the connection before anyone is invited to trust a suite run against it.
  await probeAgent({ client: admin, workspaceId: workspace.id, agentId: agent.id as string, config });

  revalidatePath("/dashboard");
  redirect(`/agents/${agent.id}`);
}

/** Freezes a new immutable policy version for an agent. */
export async function savePolicyVersion(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  const agentId = String(form.get("agentId") ?? "");
  const body = String(form.get("body") ?? "").trim();

  if (!body) return { error: "A policy version cannot be empty." };

  const admin = await assertMembership(user.id, workspace.id);

  const { data: latest } = await admin
    .from("policies")
    .select("version")
    .eq("agent_id", agentId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await admin.from("policies").insert({
    workspace_id: workspace.id,
    agent_id: agentId,
    version: (latest?.version ?? 0) + 1,
    body,
    created_by: user.id,
  });

  if (error) return { error: `Could not save the policy: ${error.message}` };

  revalidatePath(`/agents/${agentId}`);
  return { notice: `Saved as version ${(latest?.version ?? 0) + 1}.` };
}

/** Re-probes an existing agent and stores a fresh receipt. */
export async function reprobeAgent(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  const agentId = String(form.get("agentId") ?? "");
  const admin = await assertMembership(user.id, workspace.id);

  const { data: agent, error } = await admin
    .from("agents").select("config").eq("id", agentId).eq("workspace_id", workspace.id).single();
  if (error || !agent) return { error: "That agent could not be found." };

  const result = await probeAgent({
    client: admin, workspaceId: workspace.id, agentId, config: agent.config as AgentConfig,
  });

  revalidatePath(`/agents/${agentId}`);
  return result.ok
    ? { notice: "The agent answered. Receipt saved." }
    : { error: `No answer: ${result.error}` };
}

/** Creates a queued run; execution is started by the run page. */
export async function createRun(formData: FormData): Promise<void> {
  const { user, workspace } = await requireWorkspace();
  const agentId = String(formData.get("agentId") ?? "");
  const admin = await assertMembership(user.id, workspace.id);

  const { data: policy } = await admin
    .from("policies").select("id").eq("agent_id", agentId)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (!policy) throw new Error("Save a policy version before running the suite.");

  const { data: suite } = await admin
    .from("suites").select("id").is("workspace_id", null)
    .eq("key", "eu-support").eq("version", 1).single();

  const { data: previous } = await admin
    .from("runs").select("id").eq("agent_id", agentId).eq("status", "completed")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  const { data: agent } = await admin
    .from("agents").select("attestation_text").eq("id", agentId).single();

  const { data: run, error } = await admin
    .from("runs")
    .insert({
      workspace_id: workspace.id, agent_id: agentId, policy_id: policy.id,
      suite_id: suite!.id, baseline_run_id: previous?.id ?? null, status: "queued",
      judge_source: "trial_free", attestation_text: agent?.attestation_text ?? null,
      created_by: user.id,
    })
    .select("id").single();

  if (error) throw new Error(`Could not start the run: ${error.message}`);

  redirect(`/runs/${run.id}`);
}
