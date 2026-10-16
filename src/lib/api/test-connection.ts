import type { PreflightResult } from "../agents/preflight.ts";

/**
 * The body and the answer of `POST /api/v1/agents/test-connection`. Pure, so the shape is tested
 * without a request.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FIELDS = ["url", "body_template", "response_path", "tool_activity_path", "timeout_seconds", "auth_header_name", "auth_value"] as const;

export type TestConnectionBody =
  | { kind: "agent"; agentId: string }
  | {
      kind: "fields";
      fields: {
        url: unknown; bodyTemplate: unknown; responsePath: unknown; toolActivityPath: unknown;
        timeoutSeconds: unknown; authHeaderName: unknown; credential: unknown;
      };
    };

export function parseTestConnectionBody(raw: unknown): TestConnectionBody | { error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "Send a JSON object: { \"url\": \"https://…\", \"response_path\": \"reply\" } or { \"agent_id\": \"…\" }." };
  }
  const body = raw as Record<string, unknown>;
  const given = FIELDS.filter((f) => body[f] !== undefined && body[f] !== null);

  if (body.agent_id !== undefined && body.agent_id !== null) {
    if (typeof body.agent_id !== "string" || !UUID.test(body.agent_id)) {
      return { error: "`agent_id` must be an agent id. GET /api/v1/agents lists them." };
    }
    if (given.length) return { error: "Send `agent_id` to test a saved agent, or the connection fields to test a new one — not both." };
    return { kind: "agent", agentId: body.agent_id };
  }

  for (const f of FIELDS) {
    const v = body[f];
    if (v === undefined || v === null) continue;
    if (f === "body_template" && typeof v === "object" && !Array.isArray(v)) continue;
    if (f === "timeout_seconds" && typeof v === "number") continue;
    if (typeof v !== "string") {
      return { error: f === "body_template" ? "`body_template` must be a JSON object, or that object as a string." : f === "timeout_seconds" ? "`timeout_seconds` must be a whole number." : `\`${f}\` must be a string.` };
    }
  }
  const template = body.body_template;
  return {
    kind: "fields",
    fields: {
      url: body.url,
      bodyTemplate: template && typeof template === "object" ? JSON.stringify(template) : template,
      // The reply path defaults as on the connect form.
      responsePath: body.response_path ?? "reply",
      toolActivityPath: body.tool_activity_path,
      timeoutSeconds: typeof body.timeout_seconds === "number" ? String(body.timeout_seconds) : body.timeout_seconds,
      authHeaderName: body.auth_header_name,
      credential: body.auth_value,
    },
  };
}

/** The answer: snake_case, the stable `outcome` first. Nothing in it is a credential or a stored id. */
export function preflightAnswer(r: PreflightResult) {
  return {
    outcome: r.outcome,
    ok: r.ok,
    headline: r.headline,
    detail: r.detail,
    status_code: r.statusCode,
    latency_ms: r.latencyMs,
    ...(r.replyPreview !== undefined ? { reply_preview: r.replyPreview, reply_truncated: Boolean(r.replyTruncated) } : {}),
    ...(r.topLevelKeys !== undefined ? { top_level_keys: r.topLevelKeys, suggested_path: r.suggestedPath ?? null } : {}),
    stored: false,
  };
}
