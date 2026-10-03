import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoutedChat } from "../router/execute.ts";
import type { SuiteCase } from "../runner/types.ts";
import type { AgentConfig } from "../agents/types.ts";
import { validateSuite } from "../suites/validate.ts";
import { buildPromotedSuite } from "../scenarios/promote.ts";
import { recordAudit } from "../audit/record.ts";
import { startRun, RunRefusal } from "../workflow/start-run.ts";
import { packByKey, packCases } from "./packs.ts";
import { formatFromName, parseSource, partsOf, sha256, type SourceFormat } from "./sources.ts";
import { fetchPublicPage } from "./fetch-page.ts";
import { extractObligations, idAllocator } from "./extract.ts";
import { findConflicts, observeAgent, toolsFromActivity } from "./discovery.ts";
import { bulkEligible, buildCoverage, type CandidateRow, type ObligationRow } from "./coverage.ts";
import { AUTHORISE_MATERIAL, AUTHORISE_FETCH, ACKNOWLEDGEMENT } from "./constants.ts";

/**
 * The Suite Builder's work, one function per step, each taking the service-role client
 * and the person's id. The server actions call these after `gate()` has checked the
 * person's role; the verifier calls them directly. Every rule that matters is also in
 * the database (0056): these functions are where a refusal becomes a sentence.
 */

export type Done<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

export { AUTHORISE_MATERIAL, AUTHORISE_FETCH, ACKNOWLEDGEMENT };

interface Ctx { db: SupabaseClient; workspaceId: string; userId: string }

async function loadBuild(ctx: Ctx, buildId: string) {
  const { data } = await ctx.db.from("suite_builds").select("*").eq("id", buildId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  return data as null | {
    id: string; name: string; status: string; pack_key: string | null; pack_version: number | null; quick: boolean;
    agent_id: string | null; scope: string | null; prepared_for: string | null; goal: string | null; created_at: string;
  };
}

function riskOf(severity: string): "low" | "medium" | "high" {
  return severity === "critical" || severity === "high" ? "high" : severity === "low" ? "low" : "medium";
}

/** A database refusal in the words a person can act on. */
function plain(message: string): string {
  return message.replace(/^ERROR:\s*/, "");
}

// ------------------------------------------------------------------ start

export async function startBuild(ctx: Ctx, input: {
  name: string; packKey?: string | null; quick?: boolean; goal?: string | null; preparedFor?: string | null; agentId?: string | null;
}): Promise<Done<{ buildId: string; candidates: number }>> {
  const name = input.name.trim().slice(0, 120);
  if (!name) return { ok: false, error: "Give the suite a name — it becomes the suite's name when you publish it." };
  const pack = input.packKey ? packByKey(input.packKey) : null;
  if (input.packKey && (!pack || pack.status !== "published")) return { ok: false, error: "That pack is not offered." };
  if (input.agentId) {
    const { data: agent } = await ctx.db.from("agents").select("id").eq("id", input.agentId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (!agent) return { ok: false, error: "That agent is not in this workspace." };
  }

  const { data: build, error } = await ctx.db.from("suite_builds").insert({
    workspace_id: ctx.workspaceId, name,
    prepared_for: input.preparedFor?.trim().slice(0, 120) || null,
    goal: input.goal && ["own_agent", "client_delivery", "governance"].includes(input.goal) ? input.goal : null,
    pack_key: pack?.key ?? null, pack_version: pack?.version ?? null, quick: Boolean(pack && input.quick),
    agent_id: input.agentId || null, created_by: ctx.userId,
  }).select("id").single();
  if (error || !build) return { ok: false, error: `The build could not be started: ${error?.message ?? "no row"}` };

  let count = 0;
  if (pack) {
    const cases = packCases(pack, Boolean(input.quick));
    const rows = cases.map((c) => {
      const caveat = pack.needs_customer_policy?.[c.id];
      return {
        workspace_id: ctx.workspaceId, build_id: build.id, origin: "pack",
        source_ref: { pack_key: pack.key, pack_version: pack.version, case_id: c.id, suite: pack.source.suite, suite_version: pack.source.version },
        scenario: c, duty_refs: c.duty_refs ?? [], risk_level: riskOf(c.severity),
        destructive: c.destructive === true, fixture_only: c.fixture_only === true,
        status: caveat ? "needs_review" : "draft",
        review_note: caveat ?? null,
        created_by: ctx.userId,
      };
    });
    const { error: draftError } = await ctx.db.from("scenario_drafts").insert(rows);
    if (draftError) return { ok: false, error: `The pack's scenarios could not be added: ${draftError.message}` };
    count = rows.length;
  }
  return { ok: true, buildId: build.id as string, candidates: count };
}

// ------------------------------------------------------------------ sources

export async function addSource(ctx: Ctx, input: {
  buildId: string;
  kind: "pasted" | "upload" | "url" | "tool_schema";
  title?: string;
  text?: string;
  file?: { name: string; type: string; bytes: Uint8Array };
  url?: string;
  authorised: boolean;
  /** Tests only: the fetcher, and loopback. */
  fetchOptions?: Parameters<typeof fetchPublicPage>[1];
}): Promise<Done<{ sourceId: string; status: "parsed" | "failed"; detail: string }>> {
  const build = await loadBuild(ctx, input.buildId);
  if (!build) return { ok: false, error: "That build is not in this workspace." };
  if (build.status !== "draft") return { ok: false, error: "This build is no longer a draft; start a new one to add sources." };
  if (!input.authorised) {
    return { ok: false, error: input.kind === "url" ? "Confirm that Novera may fetch this page before it is fetched." : "Confirm this material is yours to use before it is added." };
  }

  let bytes: Uint8Array;
  let format: SourceFormat;
  let title = (input.title ?? "").trim();
  let locator: string | null = null;
  let mediaType: string | undefined;
  let retrieval: Record<string, unknown> | null = null;

  if (input.kind === "url") {
    const url = (input.url ?? "").trim();
    if (!url) return { ok: false, error: "Paste the address of one page." };
    const page = await fetchPublicPage(url, input.fetchOptions);
    if (!page.ok) return { ok: false, error: page.error };
    bytes = page.body;
    format = /html|xhtml/i.test(page.contentType) ? "html" : /markdown/i.test(page.contentType) ? "markdown" : "text";
    mediaType = page.contentType.split(";")[0];
    locator = page.finalUrl;
    retrieval = { requested: url, final_url: page.finalUrl, redirects: page.redirects, status: page.status, robots: page.robots, fetched_at: new Date().toISOString(), bytes: page.body.byteLength };
    title ||= new URL(page.finalUrl).hostname + new URL(page.finalUrl).pathname;
  } else if (input.kind === "upload") {
    if (!input.file) return { ok: false, error: "Choose a file." };
    const f = input.file;
    if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") {
      return { ok: false, error: "PDF is not read yet. Save the document as .docx, Markdown or plain text, or paste the relevant section." };
    }
    const detected = formatFromName(f.name, f.type);
    if (!detected) return { ok: false, error: "Upload a .docx, .md, .txt or .html file." };
    bytes = f.bytes; format = detected; locator = f.name.slice(0, 200); title ||= f.name.slice(0, 200);
  } else {
    const text = input.text ?? "";
    if (!text.trim()) return { ok: false, error: input.kind === "tool_schema" ? "Paste the tool list or OpenAPI document." : "Paste the text." };
    bytes = new TextEncoder().encode(text);
    format = input.kind === "tool_schema" ? "json" : "markdown";
    title ||= input.kind === "tool_schema" ? "Tool schema" : "Pasted text";
  }

  const originalSha256 = sha256(bytes);
  const { data: row, error } = await ctx.db.from("suite_sources").insert({
    workspace_id: ctx.workspaceId, build_id: build.id, kind: input.kind, title: title.slice(0, 200), locator,
    original_sha256: originalSha256, byte_size: bytes.byteLength, status: "uploaded",
    authorisation: input.kind === "url" ? AUTHORISE_FETCH : AUTHORISE_MATERIAL, authorised_by: ctx.userId,
    created_by: ctx.userId,
  }).select("id").single();
  if (error || !row) return { ok: false, error: `The source could not be recorded: ${error?.message ?? "no row"}` };

  const parsed = parseSource({ bytes, format, mediaType });
  const patch = parsed.ok
    ? { status: "parsed", text: parsed.text, text_sha256: parsed.textSha256, redaction: parsed.redaction, media_type: parsed.mediaType, retrieval }
    : { status: "failed", parse_error: parsed.error, retrieval };
  const { error: parseError } = await ctx.db.from("suite_sources").update(patch).eq("id", row.id);
  if (parseError) return { ok: false, error: `The source could not be saved: ${parseError.message}` };

  if (input.kind === "url") {
    await recordAudit(ctx.db, { workspaceId: ctx.workspaceId, actorId: ctx.userId, action: "suite.source_fetched", detail: { build_id: build.id, source_id: row.id, host: locator ? new URL(locator).hostname : null } });
  }
  if (!parsed.ok) return { ok: true, sourceId: row.id as string, status: "failed", detail: parsed.error };
  const removed = Object.entries(parsed.redaction).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(", ");
  return {
    ok: true, sourceId: row.id as string, status: "parsed",
    detail: `${parsed.text.length.toLocaleString("en")} characters in ${partsOf(parsed.text).length} part(s).${removed ? ` Replaced before storing: ${removed}.` : ""}`,
  };
}

// ------------------------------------------------------------------ extraction

async function usedIds(ctx: Ctx, buildId: string): Promise<string[]> {
  const { data } = await ctx.db.from("scenario_drafts").select("scenario").eq("workspace_id", ctx.workspaceId).eq("build_id", buildId);
  return (data ?? []).map((r) => (r.scenario as SuiteCase)?.id).filter(Boolean) as string[];
}

export async function extractFromSource(ctx: Ctx, input: { sourceId: string; chat: RoutedChat }): Promise<Done<{
  obligations: number; questions: number; scenarios: number; flagged: number; refused: string[]; servedBy: string | null; part: number; parts: number;
}>> {
  const { data: source } = await ctx.db.from("suite_sources").select("id, build_id, kind, title, status, text, extracted_parts")
    .eq("id", input.sourceId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!source) return { ok: false, error: "That source is not in this workspace." };
  const build = await loadBuild(ctx, source.build_id as string);
  if (!build || build.status !== "draft") return { ok: false, error: "This build is no longer a draft." };
  if (source.status !== "parsed" || !source.text) return { ok: false, error: "This source has no readable text to extract from." };
  if (source.kind === "agent_observation") return { ok: false, error: "Observations are compared with your documents, not read for obligations." };

  const parts = partsOf(source.text as string);
  const index = source.extracted_parts as number;
  if (index >= parts.length) return { ok: false, error: "Every part of this source has already been read." };

  const outcome = await extractObligations({
    chat: input.chat, part: parts[index], title: source.title as string,
    nextId: idAllocator("D", await usedIds(ctx, build.id)),
  });
  // A part the model answered readably is read, even if nothing held up: the next press
  // moves on rather than asking the same question of the same text. One it could not
  // answer readably stays unread, so a transient failure costs nothing.
  if (outcome.consumed) await ctx.db.from("suite_sources").update({ extracted_parts: index + 1 }).eq("id", source.id);
  if (!outcome.ok || !outcome.result) return { ok: false, error: outcome.error ?? "Nothing could be extracted." };

  let questions = 0, scenarios = 0, flagged = 0;
  for (const o of outcome.result.obligations) {
    const { data: ob, error } = await ctx.db.from("suite_obligations").insert({
      workspace_id: ctx.workspaceId, build_id: build.id, source_id: source.id,
      passage: o.passage, locator: `Part ${index + 1} of ${parts.length}`, interpretation: o.interpretation,
      obligation: o.obligation, duty_refs: o.dutyRefs, question: o.question,
      suggested_answers: o.suggestedAnswers, flags: o.flags,
      status: o.question ? "open" : "drafted", model: outcome.servedBy, created_by: ctx.userId,
    }).select("id").single();
    if (error || !ob) return { ok: false, error: `An obligation could not be stored: ${error?.message ?? "no row"}` };
    if (o.question) questions++;
    if (o.flags.length) flagged++;

    const note = o.flags.length ? o.flags[0].note
      : o.question ? `Rests on an open question: ${o.question}` : null;
    if (o.scenarios.length) {
      const { error: draftError } = await ctx.db.from("scenario_drafts").insert(o.scenarios.map((s) => ({
        workspace_id: ctx.workspaceId, build_id: build.id, origin: "document",
        source_id: source.id, obligation_id: ob.id, source_quote: o.passage,
        scenario: s.scenario, duty_refs: s.scenario.duty_refs ?? [], risk_level: s.riskLevel,
        destructive: s.destructive, fixture_only: false,
        conflicts: o.flags, status: note ? "needs_review" : "draft", review_note: note,
        model: outcome.servedBy, created_by: ctx.userId,
      })));
      if (draftError) return { ok: false, error: `The drafts could not be stored: ${draftError.message}` };
      scenarios += o.scenarios.length;
    }
  }
  return {
    ok: true, obligations: outcome.result.obligations.length, questions, scenarios, flagged,
    refused: outcome.result.refused, servedBy: outcome.servedBy, part: index + 1, parts: parts.length,
  };
}

// ------------------------------------------------------------------ discovery

export async function observeAgentForBuild(ctx: Ctx, input: { buildId: string; agentId: string }): Promise<Done<{
  sourceId: string; tools: number; conflicts: number; questions: number;
}>> {
  const build = await loadBuild(ctx, input.buildId);
  if (!build || build.status !== "draft") return { ok: false, error: "That build is not a draft in this workspace." };
  const { data: agent } = await ctx.db.from("agents").select("id, name, config").eq("id", input.agentId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!agent) return { ok: false, error: "That agent is not in this workspace." };

  const [{ data: probe }, { data: runs }] = await Promise.all([
    ctx.db.from("probes").select("status_code, error, response_shape").eq("agent_id", agent.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ctx.db.from("runs").select("id").eq("agent_id", agent.id).eq("workspace_id", ctx.workspaceId).order("created_at", { ascending: false }).limit(10),
  ]);
  const runIds = (runs ?? []).map((r) => r.id as string);
  const { data: activity } = runIds.length
    ? await ctx.db.from("run_cases").select("tool_activity").in("run_id", runIds).not("tool_activity", "is", null)
    : { data: [] };

  const observation = observeAgent({
    agentName: agent.name as string, config: agent.config as AgentConfig,
    probe: (probe as { status_code: number | null; error: string | null; response_shape: unknown } | null) ?? null,
    runsRead: runIds.length, tools: toolsFromActivity((activity ?? []).map((a) => a.tool_activity)),
  });
  const text = observation.lines.join("\n");
  const bytes = new TextEncoder().encode(text);
  const { data: source, error } = await ctx.db.from("suite_sources").insert({
    workspace_id: ctx.workspaceId, build_id: build.id, kind: "agent_observation",
    title: `Observed: ${agent.name}`, locator: `agent:${agent.id}`, original_sha256: sha256(bytes), byte_size: bytes.byteLength,
    status: "uploaded", authorisation: "Recorded by Novera from this workspace's own agent configuration and runs.",
    authorised_by: ctx.userId, created_by: ctx.userId,
  }).select("id").single();
  if (error || !source) return { ok: false, error: `The observation could not be recorded: ${error?.message ?? "no row"}` };
  await ctx.db.from("suite_sources").update({ status: "parsed", text, text_sha256: sha256(text), redaction: {}, media_type: "text/plain" }).eq("id", source.id);
  if (!build.agent_id) await ctx.db.from("suite_builds").update({ agent_id: agent.id }).eq("id", build.id);

  const { data: docs } = await ctx.db.from("suite_sources").select("id, title, text").eq("build_id", build.id)
    .in("kind", ["pasted", "upload", "url"]).eq("status", "parsed").not("text", "is", null);
  const findings = findConflicts({ observation, documents: (docs ?? []) as Array<{ id: string; title: string; text: string }> });

  // A tool already tested by a discovery draft in this build is not drafted twice.
  const { data: existing } = await ctx.db.from("scenario_drafts").select("scenario").eq("build_id", build.id).eq("origin", "discovery");
  const tested = new Set((existing ?? []).flatMap((r) => ((r.scenario as SuiteCase).checks ?? []).flatMap((k) => (k.type === "tool_forbidden" ? [k.tool] : []))));
  const nextId = idAllocator("A", await usedIds(ctx, build.id));

  let conflicts = 0, questions = 0;
  for (const f of findings) {
    if (tested.has(f.tool)) continue;
    const scenario = validateSuite({ key: "builder", name: "Builder draft", version: 1, cases: [{ id: nextId(), ...f.scenario }] });
    if (!scenario.ok) continue;
    const c = scenario.suite.cases[0];
    if (f.declared) {
      conflicts++;
      const conflict = {
        kind: "observed_vs_declared",
        observed: f.observedLine.replace(/^Observed: /, ""),
        declared: { source: f.declared.sourceTitle, source_id: f.declared.sourceId, passage: f.declared.passage },
        action: `Drafted a ${c.severity}-severity scenario that the agent does not call \`${f.tool}\` while that condition is unmet.`,
      };
      const { error: e } = await ctx.db.from("scenario_drafts").insert({
        workspace_id: ctx.workspaceId, build_id: build.id, origin: "discovery", source_id: source.id,
        source_quote: f.observedLine, scenario: c, duty_refs: [], risk_level: riskOf(c.severity),
        destructive: false, fixture_only: false, conflicts: [conflict], status: "draft", created_by: ctx.userId,
      });
      if (e) return { ok: false, error: `A discovery draft could not be stored: ${e.message}` };
    } else {
      questions++;
      const { data: ob, error: e1 } = await ctx.db.from("suite_obligations").insert({
        workspace_id: ctx.workspaceId, build_id: build.id, source_id: source.id, passage: f.observedLine,
        locator: "Agent observation", interpretation: `${agent.name} can call \`${f.tool}\`. None of your sources in this build says when it may.`,
        obligation: "authorization_boundary",
        question: `May ${agent.name} call \`${f.tool}\` on its own, or only after a condition (verification, a person's approval)? If only after a condition, which one?`,
        suggested_answers: [], flags: [], status: "open", created_by: ctx.userId,
      }).select("id").single();
      if (e1 || !ob) return { ok: false, error: `A question could not be stored: ${e1?.message ?? "no row"}` };
      const { error: e2 } = await ctx.db.from("scenario_drafts").insert({
        workspace_id: ctx.workspaceId, build_id: build.id, origin: "discovery", source_id: source.id, obligation_id: ob.id,
        source_quote: f.observedLine, scenario: c, duty_refs: [], risk_level: riskOf(c.severity),
        destructive: false, fixture_only: false, conflicts: [], status: "needs_review",
        review_note: `Assumes ${agent.name} may not call \`${f.tool}\` without a condition. Answer the question first; reject this if it may.`,
        created_by: ctx.userId,
      });
      if (e2) return { ok: false, error: `A discovery draft could not be stored: ${e2.message}` };
    }
  }
  return { ok: true, sourceId: source.id as string, tools: observation.tools.length, conflicts, questions };
}

// ------------------------------------------------------------------ decisions

export async function decideCandidate(ctx: Ctx, input: {
  draftId: string; decision: "approve" | "reject" | "not_applicable" | "clarify"; reason?: string;
}): Promise<Done<{ notice: string }>> {
  const reason = (input.reason ?? "").trim().slice(0, 1000);
  const now = new Date().toISOString();
  const { data: draft } = await ctx.db.from("scenario_drafts").select("id, status, build_id")
    .eq("id", input.draftId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!draft) return { ok: false, error: "That draft is not in this workspace." };
  if (draft.status !== "draft" && draft.status !== "needs_review") return { ok: false, error: "That draft has already been decided." };

  let patch: Record<string, unknown>;
  let notice: string;
  if (input.decision === "approve") {
    patch = { status: "approved", approved_by: ctx.userId, approved_at: now };
    notice = "Approved.";
  } else if (input.decision === "reject") {
    if (!reason) return { ok: false, error: "Say why. A rejection with no reason teaches the next draft nothing." };
    patch = { status: "rejected", rejected_by: ctx.userId, rejected_at: now, rejection_reason: reason };
    notice = "Rejected.";
  } else if (input.decision === "not_applicable") {
    if (!reason) return { ok: false, error: "Say why it does not apply — that reason is part of the suite's record." };
    patch = { status: "not_applicable", not_applicable_by: ctx.userId, not_applicable_at: now, not_applicable_reason: reason };
    notice = "Marked not applicable.";
  } else {
    if (draft.status !== "draft") return { ok: false, error: "This draft is already waiting for review." };
    if (!reason) return { ok: false, error: "Say what needs clarifying, so whoever decides knows what to answer." };
    patch = { status: "needs_review", review_requested_by: ctx.userId, review_note: reason };
    notice = "Marked as needing an answer.";
  }
  const { error } = await ctx.db.from("scenario_drafts").update(patch).eq("id", draft.id).in("status", ["draft", "needs_review"]);
  if (error) return { ok: false, error: plain(error.message) };
  return { ok: true, notice };
}

export async function editCandidate(ctx: Ctx, input: {
  draftId: string; input: string; expected: string; assertions: string[]; severity: string;
}): Promise<Done<{ draftId: string }>> {
  const { data: old } = await ctx.db.from("scenario_drafts").select("*").eq("id", input.draftId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!old) return { ok: false, error: "That draft is not in this workspace." };
  if (old.status !== "draft" && old.status !== "needs_review") return { ok: false, error: "Only an undecided draft can be edited." };

  const before = old.scenario as SuiteCase;
  const severity = ["low", "medium", "high", "critical"].includes(input.severity) ? input.severity : before.severity;
  const assertions = input.assertions.map((a) => a.trim()).filter(Boolean).slice(0, 12);
  const edited = { ...before, input: input.input.trim(), expected_behavior: input.expected.trim(), assertions, severity };
  const validated = validateSuite({ key: "builder", name: "Builder draft", version: 1, cases: [edited] });
  if (!validated.ok) return { ok: false, error: validated.errors.join(" ") };

  const { data: row, error } = await ctx.db.from("scenario_drafts").insert({
    workspace_id: old.workspace_id, agent_id: old.agent_id, policy_id: old.policy_id, source_quote: old.source_quote,
    scenario: validated.suite.cases[0], duty_refs: old.duty_refs, risk_level: riskOf(severity),
    destructive: old.destructive, fixture_only: old.fixture_only, model: null, origin: old.origin,
    import_provenance: old.import_provenance, production_failure_id: old.production_failure_id,
    build_id: old.build_id, source_id: old.source_id, obligation_id: old.obligation_id,
    source_ref: old.source_ref ? { ...(old.source_ref as object), edited: true } : null,
    conflicts: old.conflicts, edited_from: old.id,
    status: old.status, review_note: old.review_note ?? (old.status === "needs_review" ? "Edited while waiting for review." : null),
    created_by: ctx.userId,
  }).select("id").single();
  if (error || !row) return { ok: false, error: plain(error?.message ?? "The edit could not be saved.") };

  const { error: rejectError } = await ctx.db.from("scenario_drafts").update({
    status: "rejected", rejected_by: ctx.userId, rejected_at: new Date().toISOString(), rejection_reason: "Replaced by an edited version.",
  }).eq("id", old.id);
  if (rejectError) return { ok: false, error: plain(rejectError.message) };
  return { ok: true, draftId: row.id as string };
}

export async function decideObligation(ctx: Ctx, input: {
  obligationId: string; answer?: string; notApplicableReason?: string;
}): Promise<Done<{ notice: string }>> {
  const { data: ob } = await ctx.db.from("suite_obligations").select("id, status, build_id")
    .eq("id", input.obligationId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!ob) return { ok: false, error: "That question is not in this workspace." };
  const now = new Date().toISOString();
  const answer = (input.answer ?? "").trim().slice(0, 2000);
  const reason = (input.notApplicableReason ?? "").trim().slice(0, 1000);

  if (answer) {
    if (ob.status !== "open") return { ok: false, error: "That question has already been decided." };
    const { error } = await ctx.db.from("suite_obligations").update({ status: "answered", answer, answered_by: ctx.userId, answered_at: now }).eq("id", ob.id);
    if (error) return { ok: false, error: plain(error.message) };
    return { ok: true, notice: "Answered. The scenarios that rest on it can now be approved or rejected." };
  }
  if (!reason) return { ok: false, error: "Answer the question, or say why it does not apply." };
  const { error } = await ctx.db.from("suite_obligations").update({ status: "not_applicable", not_applicable_reason: reason, not_applicable_by: ctx.userId, not_applicable_at: now }).eq("id", ob.id);
  if (error) return { ok: false, error: plain(error.message) };
  // Its scenarios follow: a test of something that does not apply does not belong in the suite.
  await ctx.db.from("scenario_drafts").update({
    status: "not_applicable", not_applicable_by: ctx.userId, not_applicable_at: now,
    not_applicable_reason: `Its obligation was marked not applicable: ${reason}`,
  }).eq("obligation_id", ob.id).in("status", ["draft", "needs_review"]);
  return { ok: true, notice: "Marked not applicable, with the scenarios that rest on it." };
}

export async function bulkApprove(ctx: Ctx, input: { buildId: string; draftIds: string[] }): Promise<Done<{ approved: number; group: string }>> {
  const state = await loadState(ctx, input.buildId);
  if (!state) return { ok: false, error: "That build is not in this workspace." };
  const obligations = new Map(state.obligations.map((o) => [o.id, o]));
  const wanted = new Set(input.draftIds);
  const eligible = state.candidates.filter((c) => wanted.has(c.id) && bulkEligible(c, obligations));
  if (!eligible.length) return { ok: false, error: "None of those can be approved together. Only low- and medium-severity drafts with no open question, conflict or flag can; decide the rest one by one." };
  const group = randomUUID();
  const { error } = await ctx.db.from("scenario_drafts").update({
    status: "approved", approved_by: ctx.userId, approved_at: new Date().toISOString(), approval_group: group,
  }).in("id", eligible.map((c) => c.id)).eq("status", "draft");
  if (error) return { ok: false, error: plain(error.message) };
  await recordAudit(ctx.db, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, action: "suite.bulk_approved",
    detail: { build_id: input.buildId, approval_group: group, count: eligible.length, case_ids: eligible.map((c) => c.scenario.id) },
  });
  return { ok: true, approved: eligible.length, group };
}

// ------------------------------------------------------------------ state

export async function loadState(ctx: Ctx, buildId: string) {
  const build = await loadBuild(ctx, buildId);
  if (!build) return null;
  const [{ data: candidates }, { data: obligations }, { data: agent }] = await Promise.all([
    ctx.db.from("scenario_drafts").select("id, origin, status, scenario, conflicts, obligation_id, source_ref, edited_from, destructive, created_at")
      .eq("workspace_id", ctx.workspaceId).eq("build_id", buildId).order("created_at"),
    ctx.db.from("suite_obligations").select("id, status, flags").eq("workspace_id", ctx.workspaceId).eq("build_id", buildId),
    build.agent_id ? ctx.db.from("agents").select("config").eq("id", build.agent_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const config = (agent as { config?: AgentConfig } | null)?.config;
  const rows = (candidates ?? []) as unknown as CandidateRow[];
  const obs = (obligations ?? []) as ObligationRow[];
  return {
    build, candidates: rows, obligations: obs,
    coverage: buildCoverage({ candidates: rows, obligations: obs, agentReportsTools: config ? config.kind === "http" ? Boolean(config.toolActivityPath) : false : null }),
  };
}

// ------------------------------------------------------------------ scan

export async function runExploratoryScan(ctx: Ctx, input: { buildId: string; agentId: string }): Promise<Done<{ runId: string; scenarios: number }>> {
  const state = await loadState(ctx, input.buildId);
  if (!state) return { ok: false, error: "That build is not in this workspace." };
  if (state.build.status !== "draft") return { ok: false, error: "This build is no longer a draft; run its published suite instead." };
  const live = state.candidates.filter((c) => c.status === "draft" || c.status === "needs_review" || c.status === "approved");
  if (!live.length) return { ok: false, error: "There is nothing to scan: every candidate was rejected or marked not applicable." };

  const key = `scan-${state.build.id.slice(0, 8)}`;
  const { data: versions } = await ctx.db.from("suites").select("version").eq("workspace_id", ctx.workspaceId).eq("key", key)
    .order("version", { ascending: false }).limit(1);
  const version = (versions?.[0]?.version ?? 0) + 1;
  const assembled = buildPromotedSuite({
    key, name: `Exploratory scan · ${state.build.name}`.slice(0, 120), version, baseCases: [],
    approved: live.map((c) => ({ draftId: c.id, scenario: c.scenario })),
  });
  if (!assembled.ok) return { ok: false, error: assembled.errors.join(" ") };

  const { data: suite, error } = await ctx.db.from("suites").insert({
    workspace_id: ctx.workspaceId, key, version, name: assembled.suite.name, cases: assembled.suite.cases,
    approval: "exploratory",
    provenance: {
      build_id: state.build.id, label: "Exploratory scan — not a conformity report",
      candidates: live.length, approved: live.filter((c) => c.status === "approved").length,
      undecided: live.filter((c) => c.status !== "approved").length,
      started_by: ctx.userId, started_at: new Date().toISOString(),
    },
  }).select("id").single();
  if (error || !suite) return { ok: false, error: `The scan could not be prepared: ${error?.message ?? "no row"}` };

  try {
    const run = await startRun({ client: ctx.db, workspaceId: ctx.workspaceId, userId: ctx.userId, agentId: input.agentId, suiteId: suite.id as string, exploratory: true });
    return { ok: true, runId: run.id, scenarios: assembled.suite.cases.length };
  } catch (e) {
    return { ok: false, error: e instanceof RunRefusal ? e.message : `The scan could not start: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ------------------------------------------------------------------ publish

export function suiteKeyFrom(name: string): string {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return /^[a-z0-9]/.test(slug) ? slug : `suite-${slug || "custom"}`;
}

export async function publishBuild(ctx: Ctx, input: {
  buildId: string; name: string; scope: string; acknowledged: boolean; acceptGapsReason?: string;
}): Promise<Done<{ suiteId: string; key: string; version: number; scenarios: number }>> {
  const state = await loadState(ctx, input.buildId);
  if (!state) return { ok: false, error: "That build is not in this workspace." };
  const { build, coverage } = state;
  if (build.status !== "draft" && build.status !== "approved") return { ok: false, error: `This build is ${build.status}.` };
  const name = input.name.trim().slice(0, 120);
  const scope = input.scope.trim().slice(0, 2000);
  if (!name) return { ok: false, error: "The suite needs a name." };
  if (!scope) return { ok: false, error: "Say what the suite covers — which agent, which channel, what it is for. It is printed with the suite." };
  if (!input.acknowledged) return { ok: false, error: "Confirm that this suite is testing evidence and not a certification." };
  if (coverage.approved === 0) return { ok: false, error: "Approve at least one scenario first." };
  const gaps = coverage.openQuestions + coverage.undecided;
  const gapReason = (input.acceptGapsReason ?? "").trim().slice(0, 1000);
  if (gaps > 0 && !gapReason) {
    return { ok: false, error: `${coverage.openQuestions} open question(s) and ${coverage.undecided} undecided draft(s) remain. Decide them, or publish without them by saying why.` };
  }

  const now = new Date().toISOString();
  if (build.status === "draft") {
    const { error } = await ctx.db.from("suite_builds").update({
      name, scope, status: "approved", approved_by: ctx.userId, approved_at: now,
      acknowledged_by: ctx.userId, acknowledged_at: now,
      ...(gaps > 0 ? { gaps_accepted_by: ctx.userId, gaps_accepted_at: now, gaps_accepted_reason: gapReason } : {}),
    }).eq("id", build.id).eq("status", "draft");
    if (error) return { ok: false, error: plain(error.message) };
  }

  const approved = state.candidates.filter((c) => c.status === "approved");
  const key = suiteKeyFrom(name);
  const { data: versions } = await ctx.db.from("suites").select("version").eq("workspace_id", ctx.workspaceId).eq("key", key)
    .order("version", { ascending: false }).limit(1);
  const version = (versions?.[0]?.version ?? 0) + 1;
  const assembled = buildPromotedSuite({ key, name, version, baseCases: [], approved: approved.map((c) => ({ draftId: c.id, scenario: c.scenario })) });
  if (!assembled.ok) return { ok: false, error: assembled.errors.join(" ") };

  const { data: sources } = await ctx.db.from("suite_sources").select("id, kind, title, locator, original_sha256, text_sha256, status")
    .eq("build_id", build.id).order("created_at");
  const origins = approved.reduce<Record<string, number>>((m, c) => ({ ...m, [c.origin]: (m[c.origin] ?? 0) + 1 }), {});
  const pack = build.pack_key ? packByKey(build.pack_key, build.pack_version ?? undefined) : null;

  const { data: suite, error } = await ctx.db.from("suites").insert({
    workspace_id: ctx.workspaceId, key, version, name, cases: assembled.suite.cases, approval: "customer_approved",
    provenance: {
      source_tool: "novera-suite-builder", transformation_version: 1, build_id: build.id,
      scope, prepared_for: build.prepared_for,
      pack: pack ? { key: pack.key, version: pack.version, title: pack.title, quick: build.quick, source: pack.source } : null,
      sources: (sources ?? []).filter((s) => s.status === "parsed").map((s) => ({ kind: s.kind, title: s.title, locator: s.locator, original_sha256: s.original_sha256, text_sha256: s.text_sha256 })),
      origins, edited: approved.filter((c) => c.edited_from).length,
      approved_scenarios: approved.length,
      not_applicable: coverage.notApplicable, rejected: coverage.rejected,
      gaps: gaps > 0 ? { open_questions: coverage.openQuestions, undecided: coverage.undecided, accepted_by: ctx.userId, reason: gapReason } : null,
      acknowledgement: ACKNOWLEDGEMENT,
      approved_by: ctx.userId, promoted_by: ctx.userId, promoted_at: now,
    },
  }).select("id").single();
  if (error || !suite) return { ok: false, error: `The suite version could not be created: ${error?.message ?? "no row"}` };

  const { error: markError } = await ctx.db.from("scenario_drafts").update({ status: "included", included_in_suite_id: suite.id }).in("id", assembled.draftIds);
  if (markError) return { ok: false, error: `${key} v${version} was created, but its drafts could not be marked included: ${markError.message}` };
  const { error: buildError } = await ctx.db.from("suite_builds").update({
    status: "published", published_suite_id: suite.id, published_by: ctx.userId, published_at: now,
  }).eq("id", build.id);
  if (buildError) return { ok: false, error: `${key} v${version} was created, but the build could not be closed: ${plain(buildError.message)}` };

  await recordAudit(ctx.db, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, action: gaps > 0 ? "suite.gaps_accepted" : "suite.published",
    detail: { build_id: build.id, suite_id: suite.id, key, version, scenarios: approved.length, ...(gaps > 0 ? { open_questions: coverage.openQuestions, undecided: coverage.undecided } : {}) },
  });
  return { ok: true, suiteId: suite.id as string, key, version, scenarios: approved.length };
}

export async function abandonBuild(ctx: Ctx, buildId: string): Promise<Done> {
  const { error } = await ctx.db.from("suite_builds").update({ status: "abandoned", abandoned_by: ctx.userId, abandoned_at: new Date().toISOString() })
    .eq("id", buildId).eq("workspace_id", ctx.workspaceId).in("status", ["draft", "approved"]);
  return error ? { ok: false, error: plain(error.message) } : { ok: true };
}

/** Gathers this workspace's undecided production-failure drafts into a build. */
export async function attachProductionDrafts(ctx: Ctx, buildId: string): Promise<Done<{ attached: number }>> {
  const build = await loadBuild(ctx, buildId);
  if (!build || build.status !== "draft") return { ok: false, error: "That build is not a draft in this workspace." };
  const { data, error } = await ctx.db.from("scenario_drafts").update({ build_id: build.id })
    .eq("workspace_id", ctx.workspaceId).eq("origin", "production").is("build_id", null).in("status", ["draft", "needs_review"]).select("id");
  if (error) return { ok: false, error: plain(error.message) };
  return { ok: true, attached: data?.length ?? 0 };
}

/**
 * A source of the customer's own words, saved as the agent's next policy version — only
 * when they press for it, and only text they supplied. Never an observation, never a
 * model's interpretation: a policy version is what the agent is held to.
 */
export async function useSourceAsPolicy(ctx: Ctx, input: { sourceId: string; agentId: string }): Promise<Done<{ version: number }>> {
  const { data: source } = await ctx.db.from("suite_sources").select("kind, text, status, title").eq("id", input.sourceId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!source || source.status !== "parsed" || !source.text) return { ok: false, error: "That source has no text to use." };
  if (!["pasted", "upload", "url"].includes(source.kind as string)) return { ok: false, error: "Only your own documents can become a policy version." };
  const { data: agent } = await ctx.db.from("agents").select("id").eq("id", input.agentId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!agent) return { ok: false, error: "That agent is not in this workspace." };
  const { data: latest } = await ctx.db.from("policies").select("version").eq("agent_id", agent.id).order("version", { ascending: false }).limit(1).maybeSingle();
  const version = (latest?.version ?? 0) + 1;
  const { error } = await ctx.db.from("policies").insert({ workspace_id: ctx.workspaceId, agent_id: agent.id, version, body: source.text, created_by: ctx.userId });
  if (error) return { ok: false, error: `The policy version could not be saved: ${error.message}` };
  return { ok: true, version };
}
