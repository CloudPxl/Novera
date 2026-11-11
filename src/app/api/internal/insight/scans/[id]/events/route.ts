import { BodyTooLarge, bodyTooLarge, readJsonBody } from "@/lib/api/body.ts";
import { apiJson } from "@/lib/api/respond.ts";
import { handleWorkerEvent } from "@/lib/insight/events.ts";
import { GRADING_STATE_LIMIT_CHARS, parseEventRequest, REPLY_LIMIT_BYTES } from "@/lib/insight/protocol.ts";
import { isWorkerRequest } from "@/lib/insight/worker-secret.ts";
import { serviceClient } from "@/lib/supabase/service.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A reply, its capture record and the envelope. */
// A reply, its capture, and a deferred grading carried back (src/lib/insight/grading-state.ts).
const BODY_LIMIT = REPLY_LIMIT_BYTES + GRADING_STATE_LIMIT_CHARS + 8 * 1024;

/**
 * The browser worker reports on a scan it holds: a heartbeat, the page it reached, its own
 * robots check, one scenario's reply, or why it had to stop. Bearer: the worker secret; the
 * body names the lease token the claim returned. Grading, redaction and every rule happen on
 * the server (src/lib/insight/events.ts).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!isWorkerRequest(request.headers.get("authorization"))) {
    return Response.json({ error: "Not authorised." }, { status: 401, headers: NO_STORE });
  }
  const { id } = await params;
  if (!UUID.test(id)) return apiJson({ error: "No such scan." }, 404);

  let raw: unknown;
  try {
    raw = await readJsonBody(request, BODY_LIMIT);
  } catch (e) {
    if (e instanceof BodyTooLarge) return bodyTooLarge(BODY_LIMIT);
    return apiJson({ error: "Send a JSON body: { \"worker_id\", \"lease_token\", \"event\" }." }, 400);
  }
  const parsed = parseEventRequest(raw);
  if ("error" in parsed) return apiJson({ error: parsed.error }, 400);

  try {
    const answer = await handleWorkerEvent({
      db: serviceClient(),
      scanId: id,
      workerId: parsed.worker_id,
      token: parsed.lease_token,
      event: parsed.event,
    });
    return Response.json(answer, { status: answer.ok ? 200 : answer.status, headers: NO_STORE });
  } catch (e) {
    return Response.json(
      { ok: false, status: 500, error: e instanceof Error ? e.message : "The event could not be handled.", stop: false },
      { status: 500, headers: NO_STORE },
    );
  }
}

export function GET(): Response {
  return Response.json({ error: "Use POST." }, { status: 405, headers: { Allow: "POST" } });
}
