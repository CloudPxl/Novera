"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff.ts";
import { requireWorkspace, gate } from "@/lib/auth/session.ts";
import { recordAudit } from "@/lib/audit/record.ts";
import { assertPublicUrl, PrivateAddressError } from "@/lib/net/public-url.ts";
import { classify, parseFacts, FACT_KEYS } from "@/lib/insight/classify.ts";
import { scanRefusal } from "@/lib/insight/gates.ts";
import { INSIGHT_SUITE, INSIGHT_SUITE_DIGEST } from "@/lib/insight/suite.ts";

/**
 * The operator's actions on public-demo insight scans (0082). Staff only while counsel has the
 * question (docs/LEGAL-COUNSEL-QUESTIONS.md), and checked against the live role
 * (`insight.manage`) so the rows stay workspace-scoped and opening it later is one line. Every
 * rule that matters is also held by the database or the claim function; these refuse first, in
 * words. Each change is an audit line.
 */
export interface InsightFormState {
  error?: string;
  notice?: string;
  remedy?: { href: string; label: string };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (form: FormData, key: string, max: number) => String(form.get(key) ?? "").trim().slice(0, max);
const factsFrom = (form: FormData) => parseFacts(Object.fromEntries(FACT_KEYS.map((k) => [k, form.get(k)])));

async function context() {
  await requireStaff();
  const { user, workspace, role } = await requireWorkspace();
  const gated = await gate(user.id, workspace.id, "insight.manage");
  return { user, workspace, role, gated };
}

/** Claim refusals do not count toward the 24-hour pause: nothing was opened. */
const NOTHING_OPENED = new Set(["robots_disallowed", "address_refused", "target_refused"]);

export async function createInsightTarget(_prev: InsightFormState, form: FormData): Promise<InsightFormState> {
  const { user, workspace, role, gated } = await context();
  if ("error" in gated) return { error: gated.error };

  const name = text(form, "name", 200);
  const raw = text(form, "demo_url", 2048);
  if (!name) return { error: "Name the company or the bot." };
  if (!raw) return { error: "Enter the address of the public demo page." };
  let url: URL;
  try {
    url = await assertPublicUrl(raw);
  } catch (e) {
    return { error: e instanceof PrivateAddressError ? e.message : "That is not a valid address." };
  }
  if (url.protocol !== "https:") return { error: "Use the page's https address. A scan opens only https pages." };
  url.hash = "";
  const facts = factsFrom(form);
  const { category, reasons } = classify(facts);

  const { data, error } = await gated.admin.from("insight_targets").insert({
    workspace_id: workspace.id,
    name,
    demo_url: url.toString(),
    sector: text(form, "sector", 100) || null,
    facts,
    category,
    category_reasons: reasons,
    authorisation_basis: "published_public_demo",
    authorised_by: user.id,
    authorised_by_role: role,
    notes: text(form, "notes", 4000) || null,
    created_by: user.id,
  }).select("id").single();
  if (error) {
    if (error.code === "23505") return { error: "This address is already recorded as a target in this workspace." };
    return { error: `The target could not be saved: ${error.message}` };
  }
  await recordAudit(gated.admin, { workspaceId: workspace.id, actorId: user.id, action: "insight_target.created", detail: { target_id: data.id, category } });
  revalidatePath("/insight");
  redirect(`/insight/${data.id}`);
}

export async function reclassifyInsightTarget(_prev: InsightFormState, form: FormData): Promise<InsightFormState> {
  const { user, workspace, gated } = await context();
  if ("error" in gated) return { error: gated.error };
  const targetId = text(form, "targetId", 40);
  if (!UUID.test(targetId)) return { error: "No target was named." };
  const { data: target } = await gated.admin.from("insight_targets").select("id, workspace_id, category").eq("id", targetId).maybeSingle();
  if (!target || target.workspace_id !== workspace.id) return { error: "No such target in this workspace." };

  const facts = factsFrom(form);
  const { category, reasons } = classify(facts);
  const { error } = await gated.admin.from("insight_targets").update({ facts, category, category_reasons: reasons }).eq("id", targetId);
  if (error) return { error: `The facts could not be saved: ${error.message}` };
  await recordAudit(gated.admin, { workspaceId: workspace.id, actorId: user.id, action: "insight_target.reclassified", detail: { target_id: targetId, from: target.category, to: category } });
  revalidatePath(`/insight/${targetId}`);
  revalidatePath("/insight");
  return { notice: category === target.category ? `Saved. Still category ${category}.` : `Saved. Now category ${category}${category === "A" ? "" : "; a queued scan will not be claimed"}.` };
}

export async function markInsightDoNotContact(_prev: InsightFormState, form: FormData): Promise<InsightFormState> {
  const { user, workspace, gated } = await context();
  if ("error" in gated) return { error: gated.error };
  const targetId = text(form, "targetId", 40);
  if (!UUID.test(targetId)) return { error: "No target was named." };
  if (form.get("confirm") !== "on") return { error: "Tick the box to confirm. This cannot be undone." };
  const { data: target } = await gated.admin.from("insight_targets").select("id, workspace_id, do_not_contact").eq("id", targetId).maybeSingle();
  if (!target || target.workspace_id !== workspace.id) return { error: "No such target in this workspace." };
  if (target.do_not_contact) return { notice: "Already marked do not contact." };

  const { error } = await gated.admin.from("insight_targets").update({ do_not_contact: true }).eq("id", targetId);
  if (error) return { error: `The mark could not be saved: ${error.message}` };
  // A scan waiting or running for it ends now, by the same path an operator's abort takes.
  await gated.admin.from("insight_scans")
    .update({ status: "aborted", aborted_reason: "The target was marked do not contact.", finished_at: new Date().toISOString() })
    .eq("target_id", targetId).in("status", ["queued", "running"]);
  await recordAudit(gated.admin, { workspaceId: workspace.id, actorId: user.id, action: "insight_target.do_not_contact_set", detail: { target_id: targetId } });
  revalidatePath(`/insight/${targetId}`);
  revalidatePath("/insight");
  return { notice: "Marked do not contact. No scan will run for this target again." };
}

export async function queueInsightScan(_prev: InsightFormState, form: FormData): Promise<InsightFormState> {
  const { user, workspace, role, gated } = await context();
  if ("error" in gated) return { error: gated.error };
  const targetId = text(form, "targetId", 40);
  if (!UUID.test(targetId)) return { error: "No target was named." };
  if (form.get("confirm") !== "on") return { error: "Tick the box to confirm that this page is a public demo anyone may use." };

  const { data: target } = await gated.admin.from("insight_targets").select("id, workspace_id, category, do_not_contact").eq("id", targetId).maybeSingle();
  if (!target || target.workspace_id !== workspace.id) return { error: "No such target in this workspace." };
  const { data: scans } = await gated.admin.from("insight_scans")
    .select("status, created_at, claimed_by, error_kind").eq("target_id", targetId).order("created_at", { ascending: false }).limit(20);
  const rows = (scans ?? []) as Array<{ status: string; created_at: string; claimed_by: string | null; error_kind: string | null }>;
  const active = rows.some((s) => s.status === "queued" || s.status === "running");
  const counted = rows.find((s) => s.claimed_by && !(s.error_kind && NOTHING_OPENED.has(s.error_kind)));
  const refusal = scanRefusal({ category: target.category, doNotContact: target.do_not_contact, activeScan: active, lastScanAt: counted?.created_at ?? null, now: new Date() });
  if (refusal) return { error: refusal };

  const { data, error } = await gated.admin.from("insight_scans").insert({
    workspace_id: workspace.id,
    target_id: targetId,
    suite_key: INSIGHT_SUITE.key,
    suite_version: INSIGHT_SUITE.version,
    suite_digest: INSIGHT_SUITE_DIGEST,
    scenario_ids: INSIGHT_SUITE.cases.map((c) => c.id),
    started_by: user.id,
    started_by_role: role,
  }).select("id").single();
  if (error) {
    if (error.code === "23505") return { error: "A scan of this target is already queued or running. One session at a time." };
    return { error: `The scan could not be queued: ${error.message}` };
  }
  await recordAudit(gated.admin, { workspaceId: workspace.id, actorId: user.id, action: "insight_scan.queued", detail: { scan_id: data.id, target_id: targetId } });
  revalidatePath(`/insight/${targetId}`);
  redirect(`/insight/scan/${data.id}`);
}

export async function abortInsightScan(_prev: InsightFormState, form: FormData): Promise<InsightFormState> {
  const { user, workspace, gated } = await context();
  if ("error" in gated) return { error: gated.error };
  const scanId = text(form, "scanId", 40);
  if (!UUID.test(scanId)) return { error: "No scan was named." };
  const reason = text(form, "reason", 500);
  if (reason.length < 3) return { error: "Say why, in a few words. The reason is kept with the scan." };
  const { data: scan } = await gated.admin.from("insight_scans").select("id, workspace_id, target_id, status").eq("id", scanId).maybeSingle();
  if (!scan || scan.workspace_id !== workspace.id) return { error: "No such scan in this workspace." };
  if (scan.status !== "queued" && scan.status !== "running") return { error: `The scan is ${scan.status}; it has already finished.` };

  const { data: updated, error } = await gated.admin.from("insight_scans")
    .update({ status: "aborted", aborted_reason: reason, finished_at: new Date().toISOString() })
    .eq("id", scanId).in("status", ["queued", "running"]).select("id");
  if (error) return { error: `The scan could not be aborted: ${error.message}` };
  if (!updated?.length) return { error: "The scan finished just now; there is nothing to abort." };
  await recordAudit(gated.admin, { workspaceId: workspace.id, actorId: user.id, action: "insight_scan.aborted", detail: { scan_id: scanId } });
  revalidatePath(`/insight/scan/${scanId}`);
  revalidatePath(`/insight/${scan.target_id}`);
  // Not "sends nothing more": a prompt typed before the worker next reports may already have reached the widget.
  return { notice: "Aborted. The worker stops at its next report to Novera and types no further prompt; a reply to a prompt already typed is not recorded, and what was recorded stays." };
}
