import { authenticateApiKey } from "@/lib/api/auth.ts";
import { getRun } from "@/lib/api/read.ts";
import { apiJson, reportUrl } from "@/lib/api/respond.ts";
import { serviceClient } from "@/lib/supabase/service.ts";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One run and every scenario's verdict. `?include=responses` adds what each scenario sent
 * and what the agent replied — the agent's own words, so off unless asked for, and only for
 * a key whose creator gave it the `responses` scope (0052).
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(request, "read");
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  // The same answer for a malformed id and for another workspace's run: neither exists
  // as far as this key is concerned.
  if (!UUID.test(id)) return apiJson({ error: "No such run in this workspace." }, 404);

  const url = new URL(request.url);
  const responses = url.searchParams.get("include") === "responses";
  // Refused before anything is read or recorded, in the same words as any missing scope.
  if (responses && !auth.caller.scopes.includes("responses")) {
    return apiJson({ error: "This key does not have the responses scope. Create a key with \"Can also read your agent's replies\" ticked to read them." }, 403);
  }
  const run = await getRun(serviceClient(), auth.caller.workspaceId, id, {
    responses,
    readBy: { keyId: auth.caller.keyId, via: "rest" },
  });
  if (!run) return apiJson({ error: "No such run in this workspace." }, 404);
  return apiJson({
    run: { ...run, report: run.report ? { content_hash: run.report.content_hash, url: reportUrl(url.origin, run.report.token) } : null },
  });
}
