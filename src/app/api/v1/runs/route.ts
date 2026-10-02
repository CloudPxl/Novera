import { authenticateApiKey } from "@/lib/api/auth.ts";
import { listRuns } from "@/lib/api/read.ts";
import { apiJson, reportUrl } from "@/lib/api/respond.ts";
import { serviceClient } from "@/lib/supabase/service.ts";
import { RunRefusal, startRun } from "@/lib/workflow/start-run.ts";
import { cleanDeclared } from "@/lib/report/manifest.ts";
import { claimRunRequest, IDEMPOTENCY_KEY, releaseClaim, requestHash } from "@/lib/api/idempotency.ts";

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

  // Optional: what the caller says it is testing. Stated on the report as declared.
  const customerDeclared = cleanDeclared({ releaseId: body.release_id, knowledgeBaseRevision: body.knowledge_base_revision });
  if ("error" in customerDeclared) return apiJson({ error: customerDeclared.error }, 400);

  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey !== null && !IDEMPOTENCY_KEY.test(idempotencyKey)) {
    return apiJson({ error: "`Idempotency-Key` must be 1 to 200 visible ASCII characters." }, 400);
  }

  const db = serviceClient();
  const workspaceId = auth.caller.workspaceId;
  const next = (id: string) => `POST ${new URL(request.url).origin}/api/v1/runs/${id}/execute until "done" is true.`;

  // A repeat of a request already made — a pipeline retrying after a timeout — is answered
  // with the run that request started, never a second one (0049).
  let claimedRunId: string | undefined;
  if (idempotencyKey) {
    const claim = await claimRunRequest(db, workspaceId, idempotencyKey,
      requestHash({ agentId, suiteId, releaseId: customerDeclared.releaseId, knowledgeBaseRevision: customerDeclared.knowledgeBaseRevision }));
    if (claim.kind === "conflict") {
      return apiJson({ error: "This Idempotency-Key was used for a different request in the last 24 hours. Use a new key for a new run." }, 409);
    }
    if (claim.kind === "in_progress") {
      return apiJson({ error: "A request with this Idempotency-Key is still starting its run. Send it again in a few seconds." }, 409);
    }
    if (claim.kind === "replay") {
      const { data: existing } = await db.from("runs").select("status").eq("id", claim.runId).eq("workspace_id", workspaceId).single();
      return apiJson({ run: { id: claim.runId, status: existing?.status ?? "queued" }, replayed: true, next: next(claim.runId) }, 200);
    }
    claimedRunId = claim.runId;
  }

  // The person responsible for a pipeline's run is whoever created the key it used.
  const { data: key } = await db.from("api_keys").select("created_by").eq("id", auth.caller.keyId).single();

  try {
    const run = await startRun({
      client: db,
      workspaceId,
      userId: (key?.created_by as string | null) ?? null,
      agentId,
      suiteId,
      apiKeyId: auth.caller.keyId,
      customerDeclared,
      runId: claimedRunId,
    });
    return apiJson({ run: { id: run.id, status: "queued" }, next: next(run.id) }, 201);
  } catch (e) {
    if (claimedRunId && idempotencyKey) await releaseClaim(db, workspaceId, idempotencyKey, claimedRunId);
    if (e instanceof RunRefusal) return apiJson({ error: e.message }, 409);
    return apiJson({ error: "The run could not be started." }, 500);
  }
}
