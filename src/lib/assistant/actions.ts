"use server";

import { revalidatePath } from "next/cache";
import { requireContext, assertMembership } from "@/lib/auth/session.ts";
import { can } from "@/lib/auth/permissions.ts";
import { recordAudit } from "@/lib/audit/record.ts";
import { MEMORY_LABEL, memoryForPrompt, suggestionFromPerson, type MemoryKey, type SafeMemory } from "./memory.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { workspaceEntitlement, TRIAL_RUN_LIMIT } from "@/lib/auth/entitlement.ts";
import { connectionsForWorkspace } from "@/lib/providers/workspace-connections.ts";
import { createRoutedChat } from "@/lib/router/execute.ts";
import { extractJsonObject } from "@/lib/judge/parse.ts";
import { rateLimit } from "@/lib/support/rate-limit.ts";
import {
  ASSISTANT_SYSTEM,
  HISTORY_TURNS,
  MESSAGE_MAX,
  SECRET_REFUSAL,
  looksLikeSecret,
  buildMessages,
  parseReply,
  pickDocs,
  type AssistantAction,
  type AssistantDoc,
  type AssistantSnapshot,
  type AssistantTurn,
} from "./core.ts";

export interface AssistantSuggestion {
  id: string;
  key: MemoryKey;
  label: string;
  value: string;
}

export interface AssistantResult {
  /** The conversation this answer belongs to, created with its first question. */
  threadId?: string;
  suggestion?: AssistantSuggestion;
  reply?: string;
  citations?: string[];
  actions?: AssistantAction[];
  /** Whose key answered, said plainly: the trial allowance or the workspace's own. */
  fundedBy?: string;
  error?: string;
}

/** Generous for a person, tight for a script: every question is a model call. */
const ASSISTANT_LIMIT = { max: 40, windowSeconds: 60 * 60 };

function hostOf(config: unknown): string {
  try {
    return new URL(String((config as { url?: unknown })?.url ?? "")).host || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * One question, in a stored conversation. The history the model sees is read from the
 * database — the person's own thread in this workspace — never taken from the browser, so a
 * page cannot hand the model a conversation that did not happen.
 */
export async function askAssistant(threadId: string | null, message: string): Promise<AssistantResult> {
  const ctx = await requireContext();
  const { user, workspace } = ctx;

  const question = String(message ?? "").trim();
  if (!question) return { error: "Ask a question first." };
  if (question.length > MESSAGE_MAX) return { error: `Keep it under ${MESSAGE_MAX} characters.` };
  // Before the rate limit and before any model call: a key in a question must never
  // leave this server, whichever history it arrived with.
  if (looksLikeSecret(question)) return { error: SECRET_REFUSAL };

  // Refused when the count cannot be read: every answer is a model call on Novera's quota.
  const limit = await rateLimit(`assistant:${user.id}`, ASSISTANT_LIMIT, { onError: "refuse" });
  if (!limit.counted) return { error: "The assistant could not check its hourly limit just now. Try again in a minute, or use the guide." };
  if (!limit.allowed) {
    return { error: `That is the hourly limit for the assistant. Try again in about ${limit.retryAfterMinutes} minutes, or use the guide.` };
  }

  const db = await sessionClient();
  const admin = await assertMembership(user.id, workspace.id);

  // The thread must be this person's, in this workspace. Anything else starts a new one.
  let thread: { id: string } | null = null;
  if (threadId) {
    const { data } = await admin.from("assistant_threads").select("id")
      .eq("id", threadId).eq("user_id", user.id).eq("workspace_id", workspace.id).maybeSingle();
    thread = data as { id: string } | null;
  }
  const { data: earlier } = thread
    ? await admin.from("assistant_messages").select("role, content").eq("thread_id", thread.id)
      .order("created_at", { ascending: false }).limit(HISTORY_TURNS)
    : { data: [] };
  const turns: AssistantTurn[] = ((earlier ?? []) as AssistantTurn[]).reverse();

  // Saved preferences, when the person turned memory on: theirs, and this workspace's shared ones.
  let preferences = "";
  if (ctx.profile.assistant_memory) {
    const { data: mem } = await admin.from("assistant_memory").select("key, value, workspace_id")
      .or(`and(user_id.eq.${user.id},workspace_id.is.null),workspace_id.eq.${workspace.id}`)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
    preferences = memoryForPrompt(((mem ?? []) as Array<{ key: MemoryKey; value: string; workspace_id: string | null }>)
      .map((m): SafeMemory => ({ key: m.key, value: m.value, scope: m.workspace_id ? "workspace" : "personal" })));
  }

  // Read through the person's own session: whatever comes back, RLS allowed. No key,
  // secret or policy text is read — the snapshot is names, hosts, versions and counts.
  const [{ data: agents }, { data: policies }, { data: probes }, { data: runs }, { count: reports }, { data: pages }] =
    await Promise.all([
      db.from("agents").select("id, name, config").eq("workspace_id", workspace.id).order("created_at"),
      db.from("policies").select("agent_id, version").eq("workspace_id", workspace.id).order("version", { ascending: false }),
      db.from("probes").select("agent_id, error, created_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(60),
      db.from("runs").select("id, status, created_at, agent_id").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(5),
      db.from("reports").select("*", { count: "exact", head: true }).eq("workspace_id", workspace.id),
      db.from("doc_pages").select("slug, title, body").eq("published", true).order("slug"),
    ]);

  const runIds = (runs ?? []).map((r) => r.id as string);
  const { data: cases } = runIds.length
    ? await db.from("run_cases").select("run_id, status").in("run_id", runIds)
    : { data: [] };

  const entitlement = await workspaceEntitlement({ client: admin, workspaceId: workspace.id });
  const names = new Map((agents ?? []).map((a) => [a.id as string, a.name as string]));
  const count = (runId: string, status: string) =>
    (cases ?? []).filter((c) => c.run_id === runId && c.status === status).length;

  const mayStartRuns = can(ctx.role, "run.start");
  const snapshot: AssistantSnapshot = {
    workspace: workspace.name,
    person: { role: ctx.role, accountMode: ctx.accountMode, mayStartRuns },
    funding: entitlement.ownKey
      ? `graded on the workspace's own ${entitlement.provider} key`
      : `trial allowance: ${Math.max(0, TRIAL_RUN_LIMIT - entitlement.runsUsed)} of ${TRIAL_RUN_LIMIT} runs left`,
    // A run button is offered only when one could start *and* this person's role may start it.
    canRun: entitlement.canRun && mayStartRuns,
    blockedReason: entitlement.blockedReason,
    agents: (agents ?? []).map((a) => {
      const latestProbe = (probes ?? []).find((p) => p.agent_id === a.id);
      return {
        id: a.id as string,
        name: a.name as string,
        host: hostOf(a.config),
        policyVersion: ((policies ?? []).find((p) => p.agent_id === a.id)?.version as number | undefined) ?? null,
        lastProbe: !latestProbe ? "never" : latestProbe.error ? "failed" : "ok",
      };
    }),
    runs: (runs ?? []).map((r) => ({
      id: r.id as string,
      agent: names.get(r.agent_id as string) ?? "unknown agent",
      status: r.status as string,
      date: String(r.created_at).slice(0, 16).replace("T", " "),
      passed: count(r.id as string, "pass"),
      failed: count(r.id as string, "fail"),
      noResult: count(r.id as string, "error"),
    })),
    reports: reports ?? 0,
  };

  const allDocs = (pages ?? []) as AssistantDoc[];

  let chat;
  let fundedBy: string;
  try {
    // The same resolution a run uses: a workspace with its own key is answered on that
    // key alone; otherwise on the trial allowance's free-tier keys.
    const { connections, routes, source } = await connectionsForWorkspace({ client: admin, workspaceId: workspace.id });
    chat = createRoutedChat({ connections, routes });
    fundedBy = source === "workspace_key" ? "your own key" : "the Novera trial allowance";
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No model is available to answer right now." };
  }

  const [first, ...rest] = buildMessages({
    snapshot, docs: pickDocs(question, allDocs), allDocs, history: turns, message: question, preferences,
  });

  try {
    const response = await chat("draft", {
      system: ASSISTANT_SYSTEM,
      messages: [first, ...rest],
      maxTokens: 700,
      temperature: 0,
    }, { data: "redacted_customer" });
    const parsed = parseReply(
      extractJsonObject(response.text) as Record<string, unknown> | null,
      snapshot,
      allDocs,
    );
    if (!parsed) return { error: "The answer came back unreadable. Ask again, or use the guide.", fundedBy };

    // Stored only once there is an answer to store with it.
    if (!thread) {
      const { data: created, error } = await admin.from("assistant_threads")
        .insert({ workspace_id: workspace.id, user_id: user.id, title: question.slice(0, 80) }).select("id").single();
      if (error || !created) return { error: "The conversation could not be saved. Try again.", fundedBy };
      thread = created as { id: string };
    }
    const { data: stored, error: storeError } = await admin.from("assistant_messages").insert([
      { thread_id: thread.id, role: "user", content: question },
      { thread_id: thread.id, role: "assistant", content: parsed.reply, citations: parsed.citations, funded_by: fundedBy, model: response.model ?? null },
    ]).select("id, role");
    if (storeError) return { error: "The conversation could not be saved. Try again.", fundedBy };
    await admin.from("assistant_threads").update({ last_message_at: new Date().toISOString() }).eq("id", thread.id);

    // A suggestion to remember something — only from what the person said, only if memory is
    // on, and only ever as a suggestion they accept or dismiss.
    let suggestion: AssistantSuggestion | undefined;
    const proposed = ctx.profile.assistant_memory ? suggestionFromPerson(parsed.remember, question) : null;
    const answerId = (stored ?? []).find((m) => m.role === "assistant")?.id as string | undefined;
    if (proposed && answerId) {
      const { data: cand } = await admin.from("assistant_memory_candidates")
        .insert({ user_id: user.id, workspace_id: workspace.id, message_id: answerId, key: proposed.key, value: proposed.value })
        .select("id").single();
      if (cand) suggestion = { id: cand.id as string, key: proposed.key, label: MEMORY_LABEL[proposed.key], value: proposed.value };
    }
    const { remember: _unused, ...shown } = parsed;
    void _unused;
    return { ...shown, fundedBy, threadId: thread.id, suggestion };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      error: /429|rate/i.test(detail)
        ? "The model provider is rate-limiting right now. Wait a minute and ask again."
        : "No model could answer right now. Try again shortly, or use the guide.",
      fundedBy,
    };
  }
}

export interface ThreadSummary {
  id: string;
  title: string;
  lastMessageAt: string;
}

/** This person's conversations in the active workspace, newest first. */
export async function listThreads(): Promise<ThreadSummary[]> {
  const { user, workspace } = await requireContext();
  const admin = await assertMembership(user.id, workspace.id);
  const { data } = await admin.from("assistant_threads").select("id, title, last_message_at")
    .eq("user_id", user.id).eq("workspace_id", workspace.id).order("last_message_at", { ascending: false }).limit(30);
  return (data ?? []).map((t) => ({ id: t.id as string, title: t.title as string, lastMessageAt: t.last_message_at as string }));
}

export async function loadThread(threadId: string): Promise<Array<{ role: "user" | "assistant"; content: string; citations: string[]; fundedBy: string | null }>> {
  const { user, workspace } = await requireContext();
  const admin = await assertMembership(user.id, workspace.id);
  const { data: thread } = await admin.from("assistant_threads").select("id")
    .eq("id", threadId).eq("user_id", user.id).eq("workspace_id", workspace.id).maybeSingle();
  if (!thread) return [];
  const { data } = await admin.from("assistant_messages").select("role, content, citations, funded_by")
    .eq("thread_id", threadId).order("created_at");
  return (data ?? []).map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string, citations: (m.citations as string[]) ?? [], fundedBy: (m.funded_by as string | null) ?? null }));
}

export async function deleteThread(threadId: string): Promise<void> {
  const { user, workspace } = await requireContext();
  const admin = await assertMembership(user.id, workspace.id);
  await admin.from("assistant_threads").delete().eq("id", threadId).eq("user_id", user.id).eq("workspace_id", workspace.id);
}

/**
 * The person's answer to a suggestion. Accepting is the only way a model's suggestion becomes
 * memory; the value stored is the one shown, re-checked, never re-read from the model.
 */
export async function decideSuggestion(candidateId: string, accept: boolean): Promise<{ ok: boolean; error?: string }> {
  const { user, workspace } = await requireContext();
  const admin = await assertMembership(user.id, workspace.id);
  const { data: cand } = await admin.from("assistant_memory_candidates").select("id, key, value, status, message_id")
    .eq("id", candidateId).eq("user_id", user.id).eq("workspace_id", workspace.id).maybeSingle();
  if (!cand || cand.status !== "pending") return { ok: false, error: "That suggestion is no longer open." };
  await admin.from("assistant_memory_candidates").update({ status: accept ? "accepted" : "dismissed", decided_at: new Date().toISOString() }).eq("id", cand.id);
  if (accept) {
    const { saveMemory } = await import("@/lib/workflow/memory.ts");
    const saved = await saveMemory(admin, { userId: user.id, workspaceId: null, key: cand.key as MemoryKey, value: cand.value as string, source: "approved_candidate", sourceMessageId: cand.message_id as string });
    if ("error" in saved) return { ok: false, error: saved.error };
  }
  await recordAudit(admin, { workspaceId: null, actorId: user.id, action: accept ? "memory.suggestion_accepted" : "memory.suggestion_dismissed", detail: { key: cand.key } });
  revalidatePath("/settings/profile");
  return { ok: true };
}
