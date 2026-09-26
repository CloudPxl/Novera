import { authenticateApiKey } from "@/lib/api/auth.ts";
import { apiJson } from "@/lib/api/respond.ts";
import { serviceClient } from "@/lib/supabase/service.ts";
import { advanceRun } from "@/lib/workflow/start-run.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Advances a run by one slice — about 40 seconds of grading — and says whether it is
 * done. Call it again until `done` is true; a call while another is working is refused
 * politely (`started: false`), never duplicated. The same function the run page uses.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(request, "run");
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!UUID.test(id)) return apiJson({ error: "No such run in this workspace." }, 404);

  const result = await advanceRun({ client: serviceClient(), workspaceId: auth.caller.workspaceId, runId: id });
  if (!result) return apiJson({ error: "No such run in this workspace." }, 404);
  if (result.error) return apiJson({ ...result, error: "The run stopped with an error. GET the run for details." }, 500);
  return apiJson(result);
}
