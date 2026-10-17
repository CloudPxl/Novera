"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWorkspace, gate } from "@/lib/auth/session.ts";
import { probeAgent } from "@/lib/workflow/run.ts";
import { recordAudit } from "@/lib/audit/record.ts";
import { isNoveraFixture } from "@/lib/agents/environment.ts";
import { attestationActor } from "@/lib/legal/attestation.ts";
import {
  fixtureServed, SAMPLE_AGENT_NAME, SAMPLE_POLICY, sampleAgentConfig, sampleAgentDecision, sampleAttestation, sampleVerification,
} from "@/lib/agents/sample.ts";
import type { PreflightResult } from "@/lib/agents/preflight.ts";
import { targetFromEdit, targetFromFields, testConnection } from "./preflight.ts";
import type { FormState } from "./actions.ts";

/** What the "Test connection" card shows: a result, or why nothing was sent. */
export type PreflightView = { result: PreflightResult } | { refused: string };

/**
 * "Test connection" on the connect form (no `agentId`) and on an agent's edit form (`agentId`):
 * the form's unsaved values, one diagnostic message, nothing stored. Called from a button's
 * click rather than as the form's action, so the form keeps everything typed, credential included.
 * Whoever may connect or edit an agent may test one.
 */
export async function testAgentConnection(form: FormData): Promise<PreflightView> {
  const { user, workspace } = await requireWorkspace();
  const gated = await gate(user.id, workspace.id, "agent.write");
  if ("error" in gated) return { refused: gated.error };

  const agentId = String(form.get("agentId") ?? "");
  const built = agentId
    ? await targetFromEdit(gated.admin, workspace.id, agentId, form)
    : targetFromFields({
        url: form.get("url"), bodyTemplate: form.get("bodyTemplate"), responsePath: form.get("responsePath"),
        toolActivityPath: form.get("toolActivityPath"), timeoutSeconds: form.get("timeoutSeconds"),
        authHeaderName: form.get("authHeaderName"), credential: form.get("authValue"),
      });
  if (!built.ok) return { refused: built.message };

  const tested = await testConnection(workspace.id, built.target);
  return tested.ok ? { result: tested.result } : { refused: tested.message };
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.nover.space").replace(/\/+$/, "");
}

/**
 * Connects Novera's own scripted fixture as this workspace's sample agent — or opens the one it
 * already has. Same permission and the same steps as connecting any agent: an attestation stored
 * with it, then one probe with its receipt. It is a test target from the start, with the audit
 * line marking an agent as one writes, and it carries the fixture's policy so the next step is a
 * run. Every run against it is labelled test data, on its pages and on its sealed report.
 */
export async function createSampleAgent(): Promise<FormState> {
  const { user, workspace, role } = await requireWorkspace();
  const gated = await gate(user.id, workspace.id, "agent.write");
  if ("error" in gated) return { error: gated.error };
  const admin = gated.admin;

  if (!fixtureServed()) {
    return { error: "The sample agent is not available on this deployment. Connect your own agent instead." };
  }
  const origin = appUrl();
  const config = sampleAgentConfig(origin);
  // Refused rather than created: a sample this deployment would not label as test data must not exist.
  if (!isNoveraFixture(config)) {
    return { error: "The sample agent is not available on this deployment. Connect your own agent instead." };
  }

  const { data: rows, error: readError } = await admin.from("agents").select("id, name, config, archived_at")
    .eq("workspace_id", workspace.id).eq("name", SAMPLE_AGENT_NAME);
  if (readError) return { error: "Could not check for an existing sample agent. Try again in a moment." };
  const decision = sampleAgentDecision((rows ?? []) as Array<{ id: string; name: string; config: unknown; archived_at: string | null }>);
  if (decision.action === "reuse") redirect(`/agents/${decision.agentId}`);

  const now = new Date().toISOString();
  const { data: agent, error } = await admin.from("agents").insert({
    workspace_id: workspace.id,
    name: SAMPLE_AGENT_NAME,
    kind: "http",
    config,
    verification: sampleVerification(origin),
    is_production: false,
    attested_by: user.id,
    attested_at: now,
    // Names a role and the user id, never the email, as every new attestation does (src/lib/legal/attestation.ts).
    attestation_text: sampleAttestation(attestationActor(user.id, role), now.slice(0, 10)),
  }).select("id").single();
  if (error?.code === "23505") {
    // Another click made it first (0073 allows one sample per workspace): open that one.
    const { data: rows } = await admin.from("agents").select("id, name, config, archived_at")
      .eq("workspace_id", workspace.id).eq("name", SAMPLE_AGENT_NAME);
    const raced = sampleAgentDecision((rows ?? []) as Array<{ id: string; name: string; config: unknown; archived_at: string | null }>);
    if (raced.action === "reuse") redirect(`/agents/${raced.agentId}`);
  }
  if (error || !agent) return { error: `Could not add the sample agent: ${error?.message ?? "no row returned"}` };
  const agentId = agent.id as string;

  await recordAudit(admin, {
    workspaceId: workspace.id, actorId: user.id, action: "agent.environment_changed",
    detail: { agent: agentId, production: false, sample_fixture: true },
  });

  await admin.from("policies").insert({
    workspace_id: workspace.id, agent_id: agentId, version: 1, body: SAMPLE_POLICY, created_by: user.id,
  });

  await probeAgent({ client: admin, workspaceId: workspace.id, agentId, config });

  // The whole layout, not only these pages: the top bar's run launcher lists the workspace's agents.
  revalidatePath("/", "layout");
  redirect(`/agents/${agentId}`);
}
