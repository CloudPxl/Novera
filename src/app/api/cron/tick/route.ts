import { isTickRequest } from "@/lib/schedules/secret.ts";
import { runScheduleTick } from "@/lib/schedules/tick.ts";
import { serviceClient } from "@/lib/supabase/service.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** What this invocation may spend, leaving room to answer under Vercel's 60 s. */
const TICK_BUDGET_MS = 45_000;

/**
 * The schedule clock's one entry point. pg_cron calls it through pg_net, and only when
 * a schedule is due or a scheduled run is still in progress (0036). It starts and
 * advances runs; it never reads or returns anything a workspace owns — only counts.
 */
export async function POST(request: Request) {
  const began = Date.now();
  // One answer for a missing and a wrong secret: the difference is nobody's business.
  if (!isTickRequest(request.headers.get("authorization"))) {
    return Response.json({ error: "Not authorised." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const report = await runScheduleTick({ client: serviceClient(), deadline: began + TICK_BUDGET_MS });
  return Response.json({ ...report, ms: Date.now() - began }, { headers: { "Cache-Control": "no-store" } });
}

export function GET() {
  return Response.json({ error: "Use POST." }, { status: 405, headers: { Allow: "POST" } });
}
