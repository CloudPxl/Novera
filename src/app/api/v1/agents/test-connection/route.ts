import { BodyTooLarge, bodyTooLarge, readJsonBody } from "@/lib/api/body.ts";
import { authenticateApiKey } from "@/lib/api/auth.ts";
import { apiJson } from "@/lib/api/respond.ts";
import { serviceClient } from "@/lib/supabase/service.ts";
import { targetFromAgent, targetFromFields, testConnection } from "@/lib/workflow/preflight.ts";
import { parseTestConnectionBody, preflightAnswer } from "@/lib/api/test-connection.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const STATUS = { invalid_request: 400, not_found: 404, archived: 409, not_http: 409, rate_limited: 429, limit_unavailable: 503 } as const;

/**
 * Sends one diagnostic message to an agent connection and says what came back — the same
 * function as "Test connection" on the connect and edit forms, with the same allowance (20 per
 * workspace in ten minutes). Either the connection's fields (`url`, `response_path`, …) or
 * `{ "agent_id" }` for a saved agent, on its stored credential. Needs a key with the `write`
 * scope. Nothing is stored. The answer carries a stable `outcome`.
 */
export async function POST(request: Request) {
  const auth = await authenticateApiKey(request, "write");
  if (!auth.ok) return auth.response;

  let raw: unknown;
  try {
    raw = await readJsonBody(request);
  } catch (e) {
    if (e instanceof BodyTooLarge) return bodyTooLarge();
    return apiJson({ error: "Send a JSON object: { \"url\": \"https://…\", \"response_path\": \"reply\" } or { \"agent_id\": \"…\" }.", code: "invalid_request" }, 400);
  }
  const body = parseTestConnectionBody(raw);
  if ("error" in body) return apiJson({ error: body.error, code: "invalid_request" }, 400);

  const workspaceId = auth.caller.workspaceId;
  const built = body.kind === "agent"
    ? await targetFromAgent(serviceClient(), workspaceId, body.agentId)
    : targetFromFields(body.fields);
  if (!built.ok) return apiJson({ error: built.message, code: built.code }, STATUS[built.code]);

  const tested = await testConnection(workspaceId, built.target);
  if (!tested.ok) {
    if (tested.code === "rate_limited") {
      return Response.json({ error: tested.message, code: tested.code }, {
        status: 429,
        headers: { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "retry-after": String(tested.retryAfterSeconds ?? 60) },
      });
    }
    return apiJson({ error: tested.message, code: tested.code }, STATUS[tested.code]);
  }
  return apiJson(preflightAnswer(tested.result));
}
