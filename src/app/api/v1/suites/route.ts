import { authenticateApiKey } from "@/lib/api/auth.ts";
import { listSuites } from "@/lib/api/read.ts";
import { apiJson } from "@/lib/api/respond.ts";
import { serviceClient } from "@/lib/supabase/service.ts";

export const dynamic = "force-dynamic";

/** Suite versions this workspace can run: the built-in ones and its own. */
export async function GET(request: Request) {
  const auth = await authenticateApiKey(request, "read");
  if (!auth.ok) return auth.response;
  return apiJson({ suites: await listSuites(serviceClient(), auth.caller.workspaceId) });
}
