import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { httpAgent } from "@/lib/agents/http.ts";
import type { HttpAgentConfig } from "@/lib/agents/types.ts";
import {
  classifyPreflight, PREFLIGHT_LIMIT, PREFLIGHT_MESSAGE, PREFLIGHT_TIMEOUT_MS,
  type PreflightRefusal, type PreflightResult,
} from "@/lib/agents/preflight.ts";
import {
  credentialProblem, newHttpConfig, nextHttpConfig, parseConnectionEdit, parseEndpointFields,
} from "@/lib/agents/connection.ts";
import { revealSecret } from "@/lib/store/secrets.ts";
import { COUNT_UNAVAILABLE_MESSAGE, rateLimit } from "@/lib/support/rate-limit.ts";

/**
 * "Test connection", for the connect form, the edit form and `POST /api/v1/agents/test-connection`:
 * one function, one limiter, one adapter.
 *
 * Nothing is written: no probe receipt, no agent row, no audit line. The credential, typed or
 * stored, goes only into the adapter for this one request, as on a run.
 */

export type Tested =
  | { ok: true; result: PreflightResult }
  | { ok: false; code: PreflightRefusal; message: string; retryAfterSeconds?: number };

export interface TestTarget {
  config: HttpAgentConfig;
  /** The header value, for this request only. Never returned or logged. */
  credential?: string;
}

/** Counts one test against the workspace's allowance, then sends the diagnostic message. */
export async function testConnection(workspaceId: string, target: TestTarget): Promise<Tested> {
  const limit = await rateLimit(`preflight:${workspaceId}`, PREFLIGHT_LIMIT, { onError: "refuse" });
  if (!limit.counted) return { ok: false, code: "limit_unavailable", message: COUNT_UNAVAILABLE_MESSAGE };
  if (!limit.allowed) {
    return {
      ok: false, code: "rate_limited", retryAfterSeconds: Math.max(60, limit.retryAfterMinutes * 60),
      message: `This workspace has tested ${PREFLIGHT_LIMIT.max} connections in the last ${PREFLIGHT_LIMIT.windowSeconds / 60} minutes. Try again in ${limit.retryAfterMinutes} minute${limit.retryAfterMinutes === 1 ? "" : "s"}.`,
    };
  }

  // The run's own adapter, with the test's deadline as its timeout: the same template filling,
  // the same header, the same public-address check before sending and at connection time.
  const adapter = httpAgent({ ...target.config, timeoutMs: PREFLIGHT_TIMEOUT_MS }, target.credential);
  const result = await adapter.send({ input: PREFLIGHT_MESSAGE, policy: "" });
  return { ok: true, result: classifyPreflight(result, target.config) };
}

type Built = { ok: true; target: TestTarget } | { ok: false; code: PreflightRefusal; message: string };

/** A connection as typed on the connect form (or sent to the API), read as saving reads it. */
export function targetFromFields(fields: {
  url: unknown; bodyTemplate: unknown; responsePath: unknown; toolActivityPath: unknown;
  timeoutSeconds?: unknown; authHeaderName: unknown; credential?: unknown;
}): Built {
  const endpoint = parseEndpointFields(fields);
  if (!endpoint.ok) return { ok: false, code: "invalid_request", message: endpoint.error };
  const credential = typeof fields.credential === "string" ? fields.credential : "";
  if (credential) {
    if (!endpoint.value.authHeaderName) return { ok: false, code: "invalid_request", message: "Name the header the credential goes in." };
    const problem = credentialProblem(credential);
    if (problem) return { ok: false, code: "invalid_request", message: problem };
  }
  return { ok: true, target: { config: newHttpConfig(endpoint.value), ...(credential ? { credential } : {}) } };
}

async function storedCredential(admin: SupabaseClient, workspaceId: string, agentId: string): Promise<string | undefined> {
  const secret = await revealSecret({ client: admin, workspaceId, scope: "agent_auth", agentId });
  return secret?.value;
}

async function loadAgent(admin: SupabaseClient, workspaceId: string, agentId: string) {
  const { data } = await admin.from("agents").select("id, kind, config, archived_at")
    .eq("id", agentId).eq("workspace_id", workspaceId).maybeSingle();
  return data as { id: string; kind: string; config: HttpAgentConfig; archived_at: string | null } | null;
}

/** A saved agent, exactly as a run would reach it. */
export async function targetFromAgent(admin: SupabaseClient, workspaceId: string, agentId: string): Promise<Built> {
  const agent = await loadAgent(admin, workspaceId, agentId);
  if (!agent) return { ok: false, code: "not_found", message: "No such agent in this workspace." };
  if (agent.archived_at) return { ok: false, code: "archived", message: "This agent is archived, so Novera sends it nothing. Restore it to test the connection." };
  if (agent.kind !== "http" || agent.config?.kind !== "http") return { ok: false, code: "not_http", message: "Only an HTTP agent's connection can be tested." };
  const credential = await storedCredential(admin, workspaceId, agentId);
  return { ok: true, target: { config: agent.config, ...(credential ? { credential } : {}) } };
}

/**
 * The edit form's unsaved values over a saved agent. An empty credential field means the stored
 * credential, and only while the address stays on the host it was given for — the rule saving
 * applies (`parseConnectionEdit`), so a test cannot carry a credential where a save could not.
 */
export async function targetFromEdit(admin: SupabaseClient, workspaceId: string, agentId: string, form: FormData): Promise<Built> {
  const agent = await loadAgent(admin, workspaceId, agentId);
  if (!agent) return { ok: false, code: "not_found", message: "That agent could not be found in this workspace." };
  if (agent.archived_at) return { ok: false, code: "archived", message: "This agent is archived, so Novera sends it nothing. Restore it to test the connection." };
  if (agent.kind !== "http" || agent.config?.kind !== "http") return { ok: false, code: "not_http", message: "Only an HTTP agent's connection can be tested here." };

  const { count } = await admin.from("secrets").select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId).eq("scope", "agent_auth").eq("agent_id", agentId);
  const parsed = parseConnectionEdit({
    name: form.get("name"), url: form.get("url"), bodyTemplate: form.get("bodyTemplate"),
    responsePath: form.get("responsePath"), toolActivityPath: form.get("toolActivityPath"),
    timeoutSeconds: form.get("timeoutSeconds"), authHeaderName: form.get("authHeaderName"),
    credential: form.get("credential"), removeCredential: form.get("removeCredential"),
  }, (count ?? 0) > 0, agent.config.url);
  if (!parsed.ok) return { ok: false, code: "invalid_request", message: parsed.error };
  const edit = parsed.value;

  const config = nextHttpConfig(agent.config, edit);
  const credential = edit.credential === "replace" ? edit.newCredential
    : edit.credential === "keep" ? await storedCredential(admin, workspaceId, agentId)
      : undefined;
  return { ok: true, target: { config, ...(credential ? { credential } : {}) } };
}
