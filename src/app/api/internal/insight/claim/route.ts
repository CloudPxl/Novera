import { BodyTooLarge, bodyTooLarge, readJsonBody } from "@/lib/api/body.ts";
import { apiJson } from "@/lib/api/respond.ts";
import { claimForWorker } from "@/lib/insight/claim.ts";
import { parseClaimRequest } from "@/lib/insight/protocol.ts";
import { isWorkerRequest } from "@/lib/insight/worker-secret.ts";
import { serviceClient } from "@/lib/supabase/service.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The browser worker asks for the next queued insight scan. Bearer: the worker secret
 * (src/lib/insight/worker-secret.ts). The server checks the address and robots.txt before
 * handing anything over (src/lib/insight/claim.ts). Answers carry a target's public address
 * and the suite's prompts; never a key, a reply or a person.
 */
export async function POST(request: Request): Promise<Response> {
  // One answer for a missing and a wrong secret.
  if (!isWorkerRequest(request.headers.get("authorization"))) {
    return Response.json({ error: "Not authorised." }, { status: 401, headers: NO_STORE });
  }
  let raw: unknown;
  try {
    raw = await readJsonBody(request, 4096);
  } catch (e) {
    if (e instanceof BodyTooLarge) return bodyTooLarge(4096);
    return apiJson({ error: "Send a JSON body: { \"worker_id\": \"…\" }." }, 400);
  }
  const worker = parseClaimRequest(raw);
  if ("error" in worker) return apiJson({ error: worker.error }, 400);

  try {
    const answer = await claimForWorker({ db: serviceClient(), worker });
    return Response.json(answer, { headers: NO_STORE });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "The claim failed." }, { status: 500, headers: NO_STORE });
  }
}

export function GET(): Response {
  return Response.json({ error: "Use POST." }, { status: 405, headers: { Allow: "POST" } });
}
