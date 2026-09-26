"use server";

import { requireWorkspace, assertMembership } from "@/lib/auth/session.ts";
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

export interface AssistantResult {
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

export async function askAssistant(history: AssistantTurn[], message: string): Promise<AssistantResult> {
  const { user, workspace } = await requireWorkspace();

  const question = String(message ?? "").trim();
  if (!question) return { error: "Ask a question first." };
  if (question.length > MESSAGE_MAX) return { error: `Keep it under ${MESSAGE_MAX} characters.` };
  // Before the rate limit and before any model call: a key in a question must never
  // leave this server, whichever history it arrived with.
  if (looksLikeSecret(question) || (Array.isArray(history) && history.some((t) => typeof t?.content === "string" && looksLikeSecret(t.content)))) {
    return { error: SECRET_REFUSAL };
  }
  const turns: AssistantTurn[] = (Array.isArray(history) ? history : [])
    .filter((t) => (t?.role === "user" || t?.role === "assistant") && typeof t.content === "string")
    .slice(-HISTORY_TURNS);

  const limit = await rateLimit(`assistant:${user.id}`, ASSISTANT_LIMIT);
  if (!limit.allowed) {
    return { error: `That is the hourly limit for the assistant. Try again in about ${limit.retryAfterMinutes} minutes, or use the guide.` };
  }

  const db = await sessionClient();
  const admin = await assertMembership(user.id, workspace.id);

  // Read through the person's own session: whatever comes back, RLS allowed. No key,
  // secret or policy text is read — the snapshot is names, hosts, versions and counts.
  const [{ data: agents }, { data: policies }, { data: probes }, { data: runs }, { count: reports }, { data: pages }] =
    await Promise.all([
      db.from("agents").select("id, name, config").order("created_at"),
      db.from("policies").select("agent_id, version").order("version", { ascending: false }),
      db.from("probes").select("agent_id, error, created_at").order("created_at", { ascending: false }).limit(60),
      db.from("runs").select("id, status, created_at, agent_id").order("created_at", { ascending: false }).limit(5),
      db.from("reports").select("*", { count: "exact", head: true }),
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

  const snapshot: AssistantSnapshot = {
    workspace: workspace.name,
    funding: entitlement.ownKey
      ? `graded on the workspace's own ${entitlement.provider} key`
      : `trial allowance: ${Math.max(0, TRIAL_RUN_LIMIT - entitlement.runsUsed)} of ${TRIAL_RUN_LIMIT} runs left`,
    canRun: entitlement.canRun,
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
    snapshot, docs: pickDocs(question, allDocs), allDocs, history: turns, message: question,
  });

  try {
    const response = await chat("draft", {
      system: ASSISTANT_SYSTEM,
      messages: [first, ...rest],
      maxTokens: 700,
      temperature: 0,
    });
    const parsed = parseReply(
      extractJsonObject(response.text) as Record<string, unknown> | null,
      snapshot,
      allDocs,
    );
    if (!parsed) return { error: "The answer came back unreadable. Ask again, or use the guide.", fundedBy };
    return { ...parsed, fundedBy };
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
