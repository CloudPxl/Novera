import { after } from "next/server";
import { serviceClient } from "@/lib/supabase/service.ts";
import { chainAfterSlice, isDispatchRequest } from "@/lib/workflow/dispatch.ts";
import { advanceRun } from "@/lib/workflow/start-run.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The server's own request for a run's next slice (`src/lib/workflow/dispatch.ts`). Answers 202
 * at once and runs the slice afterwards, so the slice that asked is never kept waiting. Only a
 * request carrying the run's dispatch token is accepted; every other caller gets the same 401,
 * whether or not the run exists. Returns nothing a workspace owns.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const headers = { "Cache-Control": "no-store" };
  if (!UUID.test(id) || !isDispatchRequest(request.headers.get("authorization"), id)) {
    return Response.json({ error: "Not authorised." }, { status: 401, headers });
  }
  const client = serviceClient();
  const { data: run } = await client.from("runs").select("workspace_id, status").eq("id", id).maybeSingle();
  if (!run || (run.status !== "queued" && run.status !== "running")) {
    return Response.json({ accepted: false }, { status: 200, headers });
  }
  const origin = new URL(request.url).origin;
  after(async () => {
    try {
      const result = await advanceRun({ client, workspaceId: run.workspace_id as string, runId: id });
      await chainAfterSlice({ client, origin, runId: id, result });
    } catch (thrown) {
      console.error(`Run ${id}: a dispatched slice failed: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
    }
  });
  return Response.json({ accepted: true }, { status: 202, headers });
}

export function GET() {
  return Response.json({ error: "Use POST." }, { status: 405, headers: { Allow: "POST" } });
}
