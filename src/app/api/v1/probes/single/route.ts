import { authenticateApiKey } from "@/lib/api/auth.ts";
import { apiJson } from "@/lib/api/respond.ts";
import { serviceClient } from "@/lib/supabase/service.ts";
import { CHECK_BODY_LIMIT, CHECK_BODY_TOO_LARGE, parseSingleCheckBody, secondsUntil } from "@/lib/checks/single.ts";
import { BodyTooLarge, readTextLimited } from "@/lib/net/read-body.ts";
import { checkAnswer, checkView } from "@/lib/checks/view.ts";
import { runScenarioCheck } from "@/lib/workflow/scenario-check.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Inside the platform's 60 s: the check must be finished, and recorded, before this. */
const CHECK_BUDGET_MS = 50_000;

/**
 * One scenario of a suite against one agent, graded as a run grades it — and not a run:
 * `{ "agent_id", "suite": "eu-support-v5", "scenario_id": "T07", "locale"? }` (camelCase
 * accepted too). Needs a key with the `probe` scope. `?include=responses` adds the agent's reply,
 * only for a key that also has the `responses` scope, as on `GET /api/v1/runs/{id}`.
 *
 * Never a run, a report, a score or a baseline, and never one of the trial's runs; 20 per
 * workspace in any rolling hour. Refusals are JSON with a stable `code`.
 */
export async function POST(request: Request) {
  const auth = await authenticateApiKey(request, "probe");
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const responses = url.searchParams.get("include") === "responses";
  // Refused before anything is read, sent or counted, in the same words as any missing scope.
  if (responses && !auth.caller.scopes.includes("responses")) {
    return apiJson({ error: "This key does not have the responses scope. Create a key with \"Can also read your agent's replies\" ticked to read them.", code: "missing_scope" }, 403);
  }

  let raw: unknown;
  try {
    // The body is four short fields: nothing larger is read, however much is sent.
    raw = JSON.parse(await readTextLimited(request as unknown as Response, CHECK_BODY_LIMIT));
  } catch (e) {
    if (e instanceof BodyTooLarge) return apiJson({ error: CHECK_BODY_TOO_LARGE, code: "payload_too_large" }, 413);
    return apiJson({ error: "Send a JSON body: { \"agent_id\": \"…\", \"suite\": \"eu-support-v5\", \"scenario_id\": \"T07\" }.", code: "invalid_request" }, 400);
  }
  const parsed = parseSingleCheckBody(raw);
  if ("error" in parsed) return apiJson({ error: parsed.error, code: "invalid_request" }, 400);

  const db = serviceClient();
  // The person responsible for a key's check is whoever created the key, as for a run.
  const { data: key } = await db.from("api_keys").select("created_by").eq("id", auth.caller.keyId).single();

  const result = await runScenarioCheck({
    client: db,
    workspaceId: auth.caller.workspaceId,
    target: { kind: "suite_case", ...parsed },
    userId: (key?.created_by as string | null) ?? null,
    apiKeyId: auth.caller.keyId,
    returnsResponses: responses,
    hardStop: Date.now() + CHECK_BUDGET_MS,
  });

  if (!result.ok) {
    const body = {
      error: result.message,
      code: result.code,
      ...(result.blocker ? { blocker: result.blocker } : {}),
      ...(result.resetsAt ? { rate_limit: { remaining: 0, resets_at: result.resetsAt } } : {}),
    };
    if (result.code === "rate_limited" && result.resetsAt) {
      return Response.json(body, {
        status: 429,
        headers: { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "retry-after": String(secondsUntil(result.resetsAt)) },
      });
    }
    return apiJson(body, result.status);
  }

  const suite = result.suite ? `${result.suite.key} v${result.suite.version}` : null;
  return apiJson(checkAnswer(checkView(result.check, { suite, policyVersion: result.policyVersion, responses }), result.rateLimit));
}
