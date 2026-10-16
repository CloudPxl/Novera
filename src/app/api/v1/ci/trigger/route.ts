import { authenticateApiKey } from "@/lib/api/auth.ts";
import { apiJson } from "@/lib/api/respond.ts";
import { executeInstruction, runRefusalResponse } from "@/lib/api/run-refusal.ts";
import { serviceClient } from "@/lib/supabase/service.ts";
import { parseTriggerBody } from "@/lib/ci/trigger.ts";
import { triggerCiRun } from "@/lib/ci/server.ts";

export const dynamic = "force-dynamic";

/**
 * Starts a run for a commit: `{ "agent_id", "suite": "eu-support-v5", "git_commit_sha",
 * "git_branch", "pr_number" }` (camelCase accepted too). Needs the `run` scope.
 *
 * The run starts through `startRun`, like every other run — the same checks, funding and
 * fair use. What this adds is the commit:
 *  - the same commit, agent and suite again answers 200 with the run it already started
 *    (`deduplicated: true`), whatever its state, unless that run was aborted — an aborted
 *    run seals nothing, so the commit gets a new run;
 *  - with `cancel_superseded` (default true), unfinished runs that earlier commits on the
 *    same branch started for this agent are stopped, aborted and never sealed;
 *  - the commit is the release the report states as declared, unless `release_id` is sent.
 */
export async function POST(request: Request) {
  const auth = await authenticateApiKey(request, "run");
  if (!auth.ok) return auth.response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiJson({ error: "Send a JSON body: { \"agent_id\": \"…\", \"git_commit_sha\": \"…\" }." }, 400);
  }
  const parsed = parseTriggerBody(raw);
  if ("error" in parsed) return apiJson({ error: parsed.error }, 400);

  const origin = new URL(request.url).origin;
  const links = (runId: string) => ({
    next: executeInstruction(origin, runId),
    poll_url: `${origin}/api/v1/ci/runs/${runId}`,
  });

  try {
    const outcome = await triggerCiRun({ db: serviceClient(), workspaceId: auth.caller.workspaceId, keyId: auth.caller.keyId, request: parsed });
    if (outcome.kind === "not_found") return apiJson({ error: outcome.error }, 404);
    if (outcome.kind === "in_progress") {
      return apiJson({ error: "Another request is starting the run for this commit. Send it again in a few seconds." }, 409);
    }
    if (outcome.kind === "deduplicated") {
      return apiJson({ run: { id: outcome.runId, status: outcome.status }, deduplicated: true, ...links(outcome.runId), superseded: [] }, 200);
    }
    return apiJson({ run: { id: outcome.runId, status: "queued" }, deduplicated: false, ...links(outcome.runId), superseded: outcome.superseded }, 202);
  } catch (e) {
    return runRefusalResponse(e);
  }
}
