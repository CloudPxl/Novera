"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireWorkspace, gate } from "@/lib/auth/session.ts";
import { recordAudit } from "@/lib/audit/record.ts";
import { recordModelOperation, workspaceChat } from "@/lib/providers/model-work.ts";
import { insightCard, type InsightCard } from "@/lib/insight/card.ts";
import { insightSuite, scenarioOf } from "@/lib/insight/suite.ts";
import { DOES_NOT_PROVE, FIX_SYSTEM, fixPrompt, parseFixSuggestion, validateSuggestionQuality } from "@/lib/insight/fixes.ts";
import { buildOutreachDraft, OUTCOMES, OUTREACH_TEMPLATE_VERSION, outreachProblems, SENT_CHANNELS, type OutreachKind } from "@/lib/insight/outreach.ts";
import type { InsightObservationRow, InsightScanRow, InsightTargetRow } from "@/lib/insight/types.ts";
import type { Candidate } from "@/lib/router/routes.ts";
import type { InsightFormState } from "@/lib/workflow/insight.ts";

/**
 * What follows a graded insight scan (0085): a fix suggestion a model proposes and a person
 * decides; an outreach draft written from a template and the card, approved by a person, sent by
 * hand and recorded; and the handoff of a target to an owner-authorised evaluation of an agent.
 * Every action checks the live role (`insight.manage`), every rule the database holds is refused
 * here first in words, and each change is an audit line. Nothing here sends anything to anyone.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (form: FormData, key: string, max: number) => String(form.get(key) ?? "").trim().slice(0, max);

async function context() {
  const { user, workspace, role } = await requireWorkspace();
  const gated = await gate(user.id, workspace.id, "insight.manage");
  return { user, workspace, role, gated };
}

async function scanCard(db: SupabaseClient, workspaceId: string, scanId: string): Promise<{ card: InsightCard; scan: InsightScanRow; observations: InsightObservationRow[] } | { error: string }> {
  const { data: scan } = await db.from("insight_scans").select("*").eq("id", scanId).eq("workspace_id", workspaceId).maybeSingle();
  if (!scan) return { error: "No such scan in this workspace." };
  const [{ data: target }, { data: observations }] = await Promise.all([
    db.from("insight_targets").select("*").eq("id", (scan as InsightScanRow).target_id).maybeSingle(),
    db.from("insight_observations").select("*").eq("scan_id", scanId).order("created_at"),
  ]);
  const suite = insightSuite((scan as InsightScanRow).suite_key, (scan as InsightScanRow).suite_version);
  if (!target || !suite) return { error: "The scan's target or suite could not be read." };
  const rows = (observations ?? []) as InsightObservationRow[];
  return { card: insightCard({ target: target as InsightTargetRow, scan: scan as InsightScanRow, observations: rows, suite }), scan: scan as InsightScanRow, observations: rows };
}

// ── Fix suggestions ──────────────────────────────────────────────────────────────────────────

export async function proposeInsightFix(_prev: InsightFormState, form: FormData): Promise<InsightFormState> {
  const { user, workspace, gated } = await context();
  if ("error" in gated) return { error: gated.error };
  const observationId = text(form, "observationId", 40);
  if (!UUID.test(observationId)) return { error: "No observation was named." };
  const db = gated.admin;
  const { data: o } = await db.from("insight_observations").select("*").eq("id", observationId).eq("workspace_id", workspace.id).maybeSingle();
  const observation = o as InsightObservationRow | null;
  if (!observation) return { error: "No such observation in this workspace." };
  if (observation.status !== "fail" || observation.response_text === null) return { error: "A fix is suggested only for a reply that failed." };
  const { data: open } = await db.from("insight_fix_suggestions").select("id").eq("observation_id", observationId).eq("status", "proposed").limit(1);
  if (open?.length) return { error: "A suggestion for this reply is waiting for a decision. Accept or reject it first." };
  const { data: scan } = await db.from("insight_scans").select("suite_key, suite_version").eq("id", observation.scan_id).maybeSingle();
  const suite = scan ? insightSuite(scan.suite_key as string, scan.suite_version as number) : null;
  const scenario = suite ? scenarioOf(suite, observation.scenario_id) : null;
  if (!scenario) return { error: "The scan's suite is not one this deployment knows." };

  const work = await workspaceChat({ client: db, workspaceId: workspace.id, userId: user.id });
  if ("error" in work) return { error: work.error };

  // A suggestion that breaks a rule is not stored and that model is not asked again: the next is.
  const exclude: Candidate[] = [];
  let accepted: { draft: ReturnType<typeof parseFixSuggestion>; model: string } | null = null;
  let lastProblem = "No model answered.";
  for (let attempt = 0; attempt < 3 && !accepted; attempt++) {
    let answer;
    try {
      answer = await work.chat("diagnose", {
        system: FIX_SYSTEM,
        messages: [{ role: "user", content: fixPrompt({ scenario, responseText: observation.response_text, rationale: observation.rationale }) }],
        maxTokens: 1500,
        temperature: 0,
        reasoning: "off",
      }, { data: "redacted_customer", exclude });
    } catch (e) {
      lastProblem = e instanceof Error ? e.message : "No model could be reached.";
      break;
    }
    exclude.push(answer.servedBy);
    const draft = parseFixSuggestion(answer.text);
    if ("error" in draft) { lastProblem = draft.error; continue; }
    const problems = validateSuggestionQuality(draft, observation.response_text);
    if (problems.length) { lastProblem = problems[0]; continue; }
    accepted = { draft, model: `${answer.servedBy.connection}/${answer.servedBy.model}` };
  }
  try {
    await recordModelOperation(db, {
      workspaceId: workspace.id, operation: "insight_fix", funding: work.funding, outcome: accepted ? "ok" : "no_usable_output",
      calls: work.calls, detail: `insight observation ${observationId}`,
    });
  } catch { /* a count, not evidence */ }
  if (!accepted || "error" in accepted.draft) return { error: `No suggestion met the rules, so none was stored. The last one: ${lastProblem}` };

  const d = accepted.draft;
  const { data: row, error } = await db.from("insight_fix_suggestions").insert({
    workspace_id: workspace.id, scan_id: observation.scan_id, observation_id: observationId, scenario_id: observation.scenario_id,
    finding: d.finding, evidence_quotes: d.evidence_quotes, root_cause: d.root_cause, confidence: d.confidence,
    proposed_change: d.proposed_change, where_to_apply: d.where_to_apply, validation_plan: d.validation_plan, risks: d.risks,
    does_not_prove: DOES_NOT_PROVE, human_review: true, model: accepted.model, funding: work.funding, created_by: user.id,
  }).select("id").single();
  if (error) return { error: `The suggestion could not be saved: ${error.message}` };
  await recordAudit(db, { workspaceId: workspace.id, actorId: user.id, action: "insight_fix.proposed", detail: { suggestion_id: row.id, observation_id: observationId } });
  revalidatePath(`/insight/scan/${observation.scan_id}`);
  return { notice: "A suggestion was proposed. Read it, then accept or reject it." };
}

export async function decideInsightFix(_prev: InsightFormState, form: FormData): Promise<InsightFormState> {
  const { user, workspace, role, gated } = await context();
  if ("error" in gated) return { error: gated.error };
  const id = text(form, "suggestionId", 40);
  const decision = text(form, "decision", 20);
  const reason = text(form, "reason", 1000);
  if (!UUID.test(id)) return { error: "No suggestion was named." };
  if (decision !== "accepted" && decision !== "rejected") return { error: "Accept or reject the suggestion." };
  if (decision === "rejected" && reason.length < 3) return { error: "Say why it is rejected, in a few words." };
  const { data: updated, error } = await gated.admin.from("insight_fix_suggestions")
    .update({ status: decision, decided_by: user.id, decided_by_role: role, decision_reason: reason || null, decided_at: new Date().toISOString() })
    .eq("id", id).eq("workspace_id", workspace.id).eq("status", "proposed").select("scan_id");
  if (error) return { error: `The decision could not be saved: ${error.message}` };
  if (!updated?.length) return { error: "That suggestion is not waiting for a decision." };
  await recordAudit(gated.admin, { workspaceId: workspace.id, actorId: user.id, action: "insight_fix.decided", detail: { suggestion_id: id, decision } });
  revalidatePath(`/insight/scan/${updated[0].scan_id}`);
  return { notice: decision === "accepted" ? "Accepted. It can be shared with the bot's owner." : "Rejected, with the reason kept." };
}

// ── Outreach ─────────────────────────────────────────────────────────────────────────────────

export async function draftInsightOutreach(_prev: InsightFormState, form: FormData): Promise<InsightFormState> {
  const { user, workspace, gated } = await context();
  if ("error" in gated) return { error: gated.error };
  const targetId = text(form, "targetId", 40);
  const kind = text(form, "kind", 20) as OutreachKind;
  if (!UUID.test(targetId)) return { error: "No target was named." };
  if (!["email", "dm", "follow_up", "staging_offer"].includes(kind)) return { error: "Choose what kind of note to draft." };
  const db = gated.admin;
  const { data: t } = await db.from("insight_targets").select("*").eq("id", targetId).eq("workspace_id", workspace.id).maybeSingle();
  const target = t as InsightTargetRow | null;
  if (!target) return { error: "No such target in this workspace." };
  if (target.do_not_contact) return { error: "This target is marked do not contact. No draft is written for it." };

  let card: InsightCard | null = null;
  let scanId: string | null = null;
  let replies: Array<string | null> = [];
  if (kind === "staging_offer") {
    if (target.category !== "B" && target.category !== "C") return { error: "A staging offer is for a Category B or C bot, which is never scanned. For a Category A bot, draft a note about its scan." };
  } else {
    const { data: latest } = await db.from("insight_scans").select("id").eq("target_id", targetId).eq("status", "graded").order("created_at", { ascending: false }).limit(1);
    if (!latest?.length) return { error: "A note about a scan needs a graded scan of this target." };
    const loaded = await scanCard(db, workspace.id, latest[0].id as string);
    if ("error" in loaded) return { error: loaded.error };
    card = loaded.card;
    scanId = loaded.scan.id;
    replies = loaded.observations.map((o) => o.response_text);
  }
  let firstSentOn: string | null = null;
  if (kind === "follow_up") {
    const { data: sent } = await db.from("insight_outreach_drafts").select("sent_recorded_at").eq("target_id", targetId)
      .not("sent_recorded_at", "is", null).order("sent_recorded_at").limit(1);
    if (!sent?.length) return { error: "A follow-up follows a first note recorded as sent." };
    firstSentOn = String(sent[0].sent_recorded_at).slice(0, 10);
  }

  const draft = buildOutreachDraft({ kind, sender: workspace.name, target: { name: target.name, url: target.demo_url }, card, firstSentOn });
  const problems = outreachProblems(draft, replies);
  if (problems.length) return { error: `The draft was not stored: ${problems[0]}` };
  const { data: row, error } = await db.from("insight_outreach_drafts").insert({
    workspace_id: workspace.id, target_id: targetId, scan_id: scanId, kind, template_version: OUTREACH_TEMPLATE_VERSION,
    subject: draft.subject, body: draft.body, disclosure_line: draft.disclosure, opt_out_line: draft.optOut, created_by: user.id,
  }).select("id").single();
  if (error) return { error: `The draft could not be saved: ${error.message}` };
  await recordAudit(db, { workspaceId: workspace.id, actorId: user.id, action: "insight_outreach.drafted", detail: { draft_id: row.id, target_id: targetId, kind } });
  revalidatePath(`/insight/${targetId}`);
  return { notice: "Drafted. Read it, then approve it before it is sent." };
}

/** One forward step of a draft: approve, record it sent, record what came of it. */
export async function advanceInsightOutreach(_prev: InsightFormState, form: FormData): Promise<InsightFormState> {
  const { user, workspace, gated } = await context();
  if ("error" in gated) return { error: gated.error };
  const id = text(form, "draftId", 40);
  const step = text(form, "step", 20);
  if (!UUID.test(id)) return { error: "No draft was named." };
  const db = gated.admin;
  const { data: d } = await db.from("insight_outreach_drafts").select("id, target_id, status").eq("id", id).eq("workspace_id", workspace.id).maybeSingle();
  if (!d) return { error: "No such draft in this workspace." };
  const now = new Date().toISOString();
  let update: Record<string, unknown>;
  let from: string;
  let action: "insight_outreach.approved" | "insight_outreach.sent_recorded" | "insight_outreach.outcome_recorded";
  if (step === "approve") {
    if (form.get("confirm") !== "on") return { error: "Tick the box to confirm you read the draft and it may be sent." };
    update = { status: "approved", approved_by: user.id, approved_at: now }; from = "draft"; action = "insight_outreach.approved";
  } else if (step === "sent") {
    const channel = text(form, "channel", 20);
    if (!(channel in SENT_CHANNELS)) return { error: "Say how it was sent." };
    update = { status: "sent_recorded", sent_recorded_by: user.id, sent_recorded_at: now, sent_channel: channel }; from = "approved"; action = "insight_outreach.sent_recorded";
  } else if (step === "outcome") {
    const outcome = text(form, "outcome", 20);
    if (!(outcome in OUTCOMES)) return { error: "Choose what came of it." };
    update = { status: "outcome_recorded", outcome, outcome_recorded_by: user.id, outcome_recorded_at: now }; from = "sent_recorded"; action = "insight_outreach.outcome_recorded";
  } else {
    return { error: "Unknown step." };
  }
  if (d.status !== from) return { error: `This draft is ${String(d.status).replace("_", " ")}; that step is not the next one.` };
  const { data: updated, error } = await db.from("insight_outreach_drafts").update(update).eq("id", id).eq("status", from).select("id");
  if (error) return { error: /do not contact/.test(error.message) ? "This target is marked do not contact." : `The step could not be saved: ${error.message}` };
  if (!updated?.length) return { error: "The draft moved on meanwhile; reload the page." };
  await recordAudit(db, { workspaceId: workspace.id, actorId: user.id, action, detail: { draft_id: id } });

  // Asked not to be contacted: the target is marked do not contact, for good.
  if (step === "outcome" && update.outcome === "opted_out") {
    await db.from("insight_targets").update({ do_not_contact: true }).eq("id", d.target_id).eq("do_not_contact", false);
    await db.from("insight_scans").update({ status: "aborted", aborted_reason: "The target was marked do not contact.", finished_at: now })
      .eq("target_id", d.target_id).in("status", ["queued", "running"]);
    await recordAudit(db, { workspaceId: workspace.id, actorId: user.id, action: "insight_target.do_not_contact_set", detail: { target_id: d.target_id, from: "outreach_opt_out" } });
  }
  revalidatePath(`/insight/${d.target_id}`);
  return { notice: step === "approve" ? "Approved. Copy it and send it yourself; Novera does not send it." : "Recorded." };
}

// ── Handoff ──────────────────────────────────────────────────────────────────────────────────

export async function linkInsightHandoff(_prev: InsightFormState, form: FormData): Promise<InsightFormState> {
  const { user, workspace, role, gated } = await context();
  if ("error" in gated) return { error: gated.error };
  const targetId = text(form, "targetId", 40);
  const agentId = text(form, "agentId", 40);
  if (!UUID.test(targetId) || !UUID.test(agentId)) return { error: "Choose the agent the owner authorised." };
  if (form.get("confirm") !== "on") return { error: "Tick the box to confirm the owner authorised this evaluation." };
  const db = gated.admin;
  const [{ data: target }, { data: agent }] = await Promise.all([
    db.from("insight_targets").select("id").eq("id", targetId).eq("workspace_id", workspace.id).maybeSingle(),
    db.from("agents").select("id, name").eq("id", agentId).eq("workspace_id", workspace.id).maybeSingle(),
  ]);
  if (!target || !agent) return { error: "That target or agent is not in this workspace." };
  const { error } = await db.from("insight_handoffs").insert({
    workspace_id: workspace.id, target_id: targetId, agent_id: agentId, created_by: user.id, created_by_role: role,
    note: text(form, "note", 1000) || null,
  });
  if (error) return { error: error.code === "23505" ? "That agent is already linked to this target." : `The link could not be saved: ${error.message}` };
  await recordAudit(db, { workspaceId: workspace.id, actorId: user.id, action: "insight_handoff.created", detail: { target_id: targetId, agent_id: agentId } });
  revalidatePath(`/insight/${targetId}`);
  return { notice: `Linked to ${agent.name}. Its runs are ordinary runs: attested, with sealed reports.` };
}
