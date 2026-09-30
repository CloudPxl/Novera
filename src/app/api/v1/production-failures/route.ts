import { authenticateApiKey } from "@/lib/api/auth.ts";
import { apiJson } from "@/lib/api/respond.ts";
import { serviceClient } from "@/lib/supabase/service.ts";
import { rateLimit } from "@/lib/support/rate-limit.ts";
import { FAILURE_LIMITS, recordProductionFailure, type FailureProblem } from "@/lib/regressions/record.ts";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * New failures a workspace can record per hour through the API. A failure is append-only
 * and leaves only with the workspace, so a runaway automation must not be able to fill
 * the table. Counted before the work, so a resubmission counts too — it is answered from
 * the first record without storing anything.
 */
export const FAILURE_API_LIMIT = { max: 60, windowSeconds: 3600 };

const FIELD = {
  customerMessage: "customer_message",
  agentReply: "agent_reply",
  expectedBehavior: "expected_behavior",
  whatWentWrong: "what_went_wrong",
  obligation: "obligation",
  severity: "severity",
  occurredOn: "occurred_on",
} as const;

function describe(p: FailureProblem): string {
  const name = `\`${FIELD[p.field]}\``;
  if (p.problem === "required") {
    return p.field === "customerMessage"
      ? `${name} is required: what the customer sent is what the scenario will send.`
      : `${name} is required: a regression test holds the agent to your expectation, so it cannot be left to guesswork.`;
  }
  if (p.problem === "too_long") return `${name} must be at most ${p.limit} characters.`;
  if (p.field === "obligation") return `${name} must be an obligation key such as \`data_minimisation\` (lowercase letters, digits and underscores).`;
  if (p.field === "severity") return `${name} must be one of low, medium, high, critical.`;
  return `${name} must be a date: 2026-09-26.`;
}

/**
 * Records a failure seen in production and drafts it as a regression scenario:
 * `{ "customer_message", "expected_behavior", "obligation", "severity",
 *    "agent_reply"?, "what_went_wrong"?, "agent_id"?, "occurred_on"? }`.
 *
 * Needs a key with the `write` scope. The same function as the form on /regressions:
 * everything is redacted before it is stored, the original kept only as a hash, and the
 * draft waits for a person's approval — nothing here can approve it, put it in a suite
 * or run it. The same text sent again is answered with the first record (200, not 201).
 */
export async function POST(request: Request) {
  const auth = await authenticateApiKey(request, "write");
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
  } catch {
    return apiJson({ error: "Send a JSON object: { \"customer_message\": \"…\", \"expected_behavior\": \"…\", \"obligation\": \"…\", \"severity\": \"…\" }." }, 400);
  }

  const text = (key: string): string | undefined => (typeof body[key] === "string" ? (body[key] as string) : undefined);
  for (const key of Object.values(FIELD)) {
    if (body[key] !== undefined && body[key] !== null && typeof body[key] !== "string") {
      return apiJson({ error: `\`${key}\` must be a string.` }, 400);
    }
  }
  const agentId = body.agent_id === undefined || body.agent_id === null ? null : body.agent_id;
  if (agentId !== null && (typeof agentId !== "string" || !UUID.test(agentId))) {
    return apiJson({ error: "`agent_id` must be an agent id. GET /api/v1/agents lists them." }, 400);
  }

  // Counted before any work, per workspace: several keys share one allowance.
  const limit = await rateLimit(`failures:${auth.caller.workspaceId}`, FAILURE_API_LIMIT);
  if (!limit.allowed) {
    return Response.json(
      { error: `This workspace has recorded ${FAILURE_API_LIMIT.max} failures through the API in the last hour. Try again in ${limit.retryAfterMinutes} minute(s).` },
      { status: 429, headers: { "cache-control": "no-store", "retry-after": String(Math.max(60, limit.retryAfterMinutes * 60)) } },
    );
  }

  const db = serviceClient();
  // The person responsible for what a pipeline sends is whoever created its key.
  const { data: key } = await db.from("api_keys").select("created_by").eq("id", auth.caller.keyId).single();

  const result = await recordProductionFailure({
    db,
    workspaceId: auth.caller.workspaceId,
    userId: (key?.created_by as string | null) ?? null,
    apiKeyId: auth.caller.keyId,
    input: {
      customerMessage: text(FIELD.customerMessage) ?? "",
      agentReply: text(FIELD.agentReply),
      expectedBehavior: text(FIELD.expectedBehavior) ?? "",
      whatWentWrong: text(FIELD.whatWentWrong),
      obligation: text(FIELD.obligation) ?? "",
      severity: text(FIELD.severity) ?? "",
      agentId,
      occurredOn: text(FIELD.occurredOn) ?? null,
    },
  });

  if (!result.ok) {
    if (result.kind === "invalid") return apiJson({ error: describe(result.problem), limits: FAILURE_LIMITS_API }, 400);
    // The same words for an agent in another workspace as for one that does not exist.
    if (result.kind === "unknown_agent") return apiJson({ error: "No such agent in this workspace. GET /api/v1/agents lists them." }, 404);
    if (result.kind === "draft_invalid") return apiJson({ error: result.error }, 400);
    return apiJson({ error: "The failure could not be recorded." }, 500);
  }

  const origin = new URL(request.url).origin;
  return apiJson({
    production_failure: { id: result.failureId, duplicate: result.duplicate },
    draft: result.draftId ? { id: result.draftId, scenario_id: result.scenarioId, status: "draft", review_url: `${origin}/scenarios` } : null,
    redaction: { removed: result.removed, original_kept: false },
    note: result.duplicate
      ? "This exact text was already recorded; nothing new was stored."
      : "Stored redacted. The draft enters a suite only when a person approves it in Novera.",
  }, result.duplicate ? 200 : 201);
}

const FAILURE_LIMITS_API = {
  customer_message: FAILURE_LIMITS.customerMessage,
  agent_reply: FAILURE_LIMITS.agentReply,
  expected_behavior: FAILURE_LIMITS.expectedBehavior,
  what_went_wrong: FAILURE_LIMITS.whatWentWrong,
};
