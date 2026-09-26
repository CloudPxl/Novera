import { authenticateApiKey } from "@/lib/api/auth.ts";
import { listRuns } from "@/lib/api/read.ts";
import { apiJson, reportUrl } from "@/lib/api/respond.ts";
import { serviceClient } from "@/lib/supabase/service.ts";
import { RunRefusal, startRun } from "@/lib/workflow/start-run.ts";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Recent runs, newest first, with counts from their stored cases. `?agent=<id>&limit=<1-100>` */
export async function GET(request: Request) {
  const auth = await authenticateApiKey(request, "read");
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const agent = url.searchParams.get("agent");
  const limit = Number(url.searchParams.get("limit") ?? 20);
  if (agent && !UUID.test(agent)) return apiJson({ error: "`agent` must be an agent id." }, 400);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return apiJson({ error: "`limit` must be a whole number from 1 to 100." }, 400);

  const runs = await listRuns(serviceClient(), auth.caller.workspaceId, { agentId: agent ?? undefined, limit });
  return apiJson({
    runs: runs.map((r) => ({ ...r, report: r.report ? { content_hash: r.report.content_hash, url: reportUrl(url.origin, r.report.token) } : null })),
  });
}

/**
 * Starts a run: `{ "agent_id": "…", "suite_id": "…" }` (suite optional — the newest
 * built-in version otherwise). Needs a key with the `run` scope, because it spends a
 * trial run or grading on your own model key. The same checks as the run button —
 * the same function, in fact. The run is queued; drive it with
 * `POST /api/v1/runs/<id>/execute` until it says it is done.
 */
export async function POST(request: Request) {
  const auth = await authenticateApiKey(request, "run");
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiJson({ error: "Send a JSON body: { \"agent_id\": \"…\" }." }, 400);
  }
  const agentId = typeof body?.agent_id === "string" ? body.agent_id : "";
  const suiteId = typeof body?.suite_id === "string" ? body.suite_id : null;
  if (!UUID.test(agentId)) return apiJson({ error: "`agent_id` must be an agent id. GET /api/v1/agents lists them." }, 400);
  if (suiteId !== null && !UUID.test(suiteId)) return apiJson({ error: "`suite_id` must be a suite id. GET /api/v1/suites lists them." }, 400);

  const db = serviceClient();
  // The person responsible for a pipeline's run is whoever created the key it used.
  const { data: key } = await db.from("api_keys").select("created_by").eq("id", auth.caller.keyId).single();

  try {
    const run = await startRun({
      client: db,
      workspaceId: auth.caller.workspaceId,
      userId: (key?.created_by as string | null) ?? null,
      agentId,
      suiteId,
      apiKeyId: auth.caller.keyId,
    });
    return apiJson({
      run: { id: run.id, status: "queued" },
      next: `POST ${new URL(request.url).origin}/api/v1/runs/${run.id}/execute until "done" is true.`,
    }, 201);
  } catch (e) {
    if (e instanceof RunRefusal) return apiJson({ error: e.message }, 409);
    return apiJson({ error: "The run could not be started." }, 500);
  }
}
