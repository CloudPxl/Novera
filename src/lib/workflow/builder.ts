"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWorkspace, gate } from "@/lib/auth/session.ts";
import type { Capability } from "@/lib/auth/permissions.ts";
import { createRoutedChat } from "@/lib/router/execute.ts";
import { DEFAULT_ROUTES } from "@/lib/router/routes.ts";
import { connectionsFromEnv } from "@/lib/providers/registry.ts";
import * as builder from "@/lib/builder/service.ts";
import type { FormState } from "@/lib/workflow/actions.ts";

/**
 * The Suite Builder's buttons. Each checks the person's role against the live membership,
 * then hands the work to `src/lib/builder/service.ts`, which the verifier drives directly.
 * Drafting is for those who draft; deciding and publishing for those who approve; a scan
 * for those who run suites — the same split as every other draft in the product.
 */

async function context(capability: Capability) {
  const { user, workspace } = await requireWorkspace();
  const gated = await gate(user.id, workspace.id, capability);
  if ("error" in gated) return { error: gated.error } as const;
  return { ctx: { db: gated.admin, workspaceId: workspace.id, userId: user.id } } as const;
}

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

export async function startBuildAction(_prev: FormState, form: FormData): Promise<FormState> {
  const c = await context("scenario.draft");
  if ("error" in c) return { error: c.error };
  const pack = text(form, "pack");
  const result = await builder.startBuild(c.ctx, {
    name: text(form, "name"),
    packKey: pack && pack !== "none" ? pack : null,
    quick: text(form, "size") !== "full",
    goal: text(form, "goal") || null,
    preparedFor: text(form, "preparedFor") || null,
    agentId: text(form, "agentId") || null,
  });
  if (!result.ok) return { error: result.error };
  revalidatePath("/builder");
  redirect(`/builder/${result.buildId}?step=${pack && pack !== "none" ? "review" : "sources"}`);
}

export async function addSourceAction(_prev: FormState, form: FormData): Promise<FormState> {
  const c = await context("scenario.draft");
  if ("error" in c) return { error: c.error };
  const buildId = text(form, "buildId");
  const kind = text(form, "kind") as "pasted" | "upload" | "url" | "tool_schema";
  if (!["pasted", "upload", "url", "tool_schema"].includes(kind)) return { error: "Choose what you are adding." };
  const file = form.get("file");
  const result = await builder.addSource(c.ctx, {
    buildId, kind,
    title: text(form, "title"),
    text: String(form.get("text") ?? ""),
    url: text(form, "url"),
    file: kind === "upload" && file instanceof File && file.size > 0
      ? { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }
      : undefined,
    authorised: form.get("authorised") === "on",
  });
  if (!result.ok) return { error: result.error };
  revalidatePath(`/builder/${buildId}`);
  return result.status === "parsed" ? { notice: `Added. ${result.detail}` } : { error: `Recorded, but it could not be read: ${result.detail}` };
}

export async function extractAction(_prev: FormState, form: FormData): Promise<FormState> {
  const c = await context("scenario.draft");
  if ("error" in c) return { error: c.error };
  const chat = createRoutedChat({ connections: connectionsFromEnv(), routes: DEFAULT_ROUTES });
  const result = await builder.extractFromSource(c.ctx, { sourceId: text(form, "sourceId"), chat });
  revalidatePath(`/builder/${text(form, "buildId")}`);
  if (!result.ok) return { error: result.error };
  return {
    notice: `Part ${result.part} of ${result.parts} read by ${result.servedBy ?? "a model"}: ${result.obligations} obligation(s), `
      + `${result.questions} open question(s), ${result.scenarios} draft scenario(s)`
      + `${result.flagged ? `, ${result.flagged} passage(s) flagged as instruction-shaped` : ""}.`
      + (result.refused.length ? ` ${result.refused.length} dropped because they did not hold up.` : ""),
  };
}

export async function observeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const c = await context("scenario.draft");
  if ("error" in c) return { error: c.error };
  const result = await builder.observeAgentForBuild(c.ctx, { buildId: text(form, "buildId"), agentId: text(form, "agentId") });
  revalidatePath(`/builder/${text(form, "buildId")}`);
  if (!result.ok) return { error: result.error };
  return { notice: `Observed ${result.tools} tool(s): ${result.conflicts} conflict(s) with your documents, ${result.questions} question(s) where they say nothing.` };
}

export async function decideAction(_prev: FormState, form: FormData): Promise<FormState> {
  const c = await context("scenario.decide");
  if ("error" in c) return { error: c.error };
  const decision = text(form, "decision") as "approve" | "reject" | "not_applicable" | "clarify";
  if (!["approve", "reject", "not_applicable", "clarify"].includes(decision)) return { error: "Choose a decision." };
  const result = await builder.decideCandidate(c.ctx, { draftId: text(form, "draftId"), decision, reason: text(form, "reason") });
  revalidatePath(`/builder/${text(form, "buildId")}`);
  return result.ok ? { notice: result.notice } : { error: result.error };
}

export async function editAction(_prev: FormState, form: FormData): Promise<FormState> {
  const c = await context("scenario.draft");
  if ("error" in c) return { error: c.error };
  const result = await builder.editCandidate(c.ctx, {
    draftId: text(form, "draftId"), input: text(form, "input"), expected: text(form, "expected"),
    assertions: String(form.get("assertions") ?? "").split("\n"), severity: text(form, "severity"),
  });
  revalidatePath(`/builder/${text(form, "buildId")}`);
  return result.ok ? { notice: "Saved as a new draft; the original is kept, rejected as replaced." } : { error: result.error };
}

export async function answerAction(_prev: FormState, form: FormData): Promise<FormState> {
  const c = await context("scenario.decide");
  if ("error" in c) return { error: c.error };
  const notApplicable = text(form, "decision") === "not_applicable";
  const result = await builder.decideObligation(c.ctx, {
    obligationId: text(form, "obligationId"),
    answer: notApplicable ? undefined : text(form, "answer"),
    notApplicableReason: notApplicable ? text(form, "reason") : undefined,
  });
  revalidatePath(`/builder/${text(form, "buildId")}`);
  return result.ok ? { notice: result.notice } : { error: result.error };
}

export async function bulkApproveAction(_prev: FormState, form: FormData): Promise<FormState> {
  const c = await context("scenario.decide");
  if ("error" in c) return { error: c.error };
  const result = await builder.bulkApprove(c.ctx, { buildId: text(form, "buildId"), draftIds: form.getAll("draftId").map(String) });
  revalidatePath(`/builder/${text(form, "buildId")}`);
  return result.ok ? { notice: `${result.approved} approved together, recorded in the audit trail under your name.` } : { error: result.error };
}

export async function attachProductionAction(_prev: FormState, form: FormData): Promise<FormState> {
  const c = await context("scenario.draft");
  if ("error" in c) return { error: c.error };
  const result = await builder.attachProductionDrafts(c.ctx, text(form, "buildId"));
  revalidatePath(`/builder/${text(form, "buildId")}`);
  if (!result.ok) return { error: result.error };
  return result.attached ? { notice: `${result.attached} production-failure draft(s) added to this build.` } : { notice: "No production-failure drafts are waiting." };
}

export async function scanAction(_prev: FormState, form: FormData): Promise<FormState> {
  const c = await context("run.start");
  if ("error" in c) return { error: c.error };
  const result = await builder.runExploratoryScan(c.ctx, { buildId: text(form, "buildId"), agentId: text(form, "agentId") });
  if (!result.ok) return { error: result.error };
  revalidatePath("/runs");
  redirect(`/runs/${result.runId}`);
}

export async function publishAction(_prev: FormState, form: FormData): Promise<FormState> {
  const c = await context("scenario.promote");
  if ("error" in c) return { error: c.error };
  const buildId = text(form, "buildId");
  const result = await builder.publishBuild(c.ctx, {
    buildId, name: text(form, "name"), scope: text(form, "scope"),
    acknowledged: form.get("acknowledged") === "on",
    acceptGapsReason: text(form, "gapsReason"),
  });
  if (!result.ok) return { error: result.error };
  revalidatePath("/builder");
  revalidatePath("/scenarios");
  redirect(`/builder/${buildId}?step=publish`);
}

export async function abandonAction(_prev: FormState, form: FormData): Promise<FormState> {
  const c = await context("scenario.draft");
  if ("error" in c) return { error: c.error };
  const result = await builder.abandonBuild(c.ctx, text(form, "buildId"));
  if (!result.ok) return { error: result.error };
  revalidatePath("/builder");
  redirect("/builder");
}

export async function sourceAsPolicyAction(_prev: FormState, form: FormData): Promise<FormState> {
  const c = await context("policy.write");
  if ("error" in c) return { error: c.error };
  const result = await builder.useSourceAsPolicy(c.ctx, { sourceId: text(form, "sourceId"), agentId: text(form, "agentId") });
  revalidatePath(`/builder/${text(form, "buildId")}`);
  return result.ok ? { notice: `Saved as policy v${result.version} — your own text, word for word.` } : { error: result.error };
}
