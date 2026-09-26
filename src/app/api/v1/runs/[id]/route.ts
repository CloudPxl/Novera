import { authenticateApiKey } from "@/lib/api/auth.ts";
import { getRun } from "@/lib/api/read.ts";
import { apiJson, reportUrl } from "@/lib/api/respond.ts";
import { serviceClient } from "@/lib/supabase/service.ts";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One run and every scenario's verdict. `?include=responses` adds what each scenario sent
 * and what the agent replied — the agent's own words, so off unless asked for.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(request, "read");
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  // The same answer for a malformed id and for another workspace's run: neither exists
  // as far as this key is concerned.
  if (!UUID.test(id)) return apiJson({ error: "No such run in this workspace." }, 404);

  const url = new URL(request.url);
  const run = await getRun(serviceClient(), auth.caller.workspaceId, id, {
    responses: url.searchParams.get("include") === "responses",
  });
  if (!run) return apiJson({ error: "No such run in this workspace." }, 404);
  return apiJson({
    run: { ...run, report: run.report ? { content_hash: run.report.content_hash, url: reportUrl(url.origin, run.report.token) } : null },
  });
}
