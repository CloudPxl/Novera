import { authenticateApiKey } from "@/lib/api/auth.ts";
import { listRuns } from "@/lib/api/read.ts";
import { apiJson, reportUrl } from "@/lib/api/respond.ts";
import { serviceClient } from "@/lib/supabase/service.ts";

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
