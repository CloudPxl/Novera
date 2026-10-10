import { authenticateApiKey } from "@/lib/api/auth.ts";
import { listAgents } from "@/lib/api/read.ts";
import { apiJson } from "@/lib/api/respond.ts";
import { serviceClient } from "@/lib/supabase/service.ts";

export const dynamic = "force-dynamic";

/**
 * The workspace's agents: name, host, whether it serves real customers, latest policy version.
 * Archived agents only when asked: `?archived=include` or `?archived=only`.
 */
export async function GET(request: Request) {
  const auth = await authenticateApiKey(request, "read");
  if (!auth.ok) return auth.response;
  const asked = new URL(request.url).searchParams.get("archived") ?? "exclude";
  if (asked !== "exclude" && asked !== "include" && asked !== "only") {
    return apiJson({ error: "archived must be exclude, include or only." }, 400);
  }
  return apiJson({ agents: await listAgents(serviceClient(), auth.caller.workspaceId, asked) });
}
