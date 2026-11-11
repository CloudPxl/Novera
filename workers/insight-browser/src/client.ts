import type { ClaimAnswer, ClaimRequest, EventAnswer, WorkerEvent } from "../../../src/lib/insight/protocol.ts";

/** The worker's only way to Novera: two POST routes, bearer the worker secret. Nothing else is sent. */
export interface ServerClient {
  claim(body: ClaimRequest): Promise<ClaimAnswer>;
  event(scanId: string, body: { worker_id: string; lease_token: string; event: WorkerEvent }): Promise<EventAnswer>;
}

const TIMEOUT_MS = 55_000;

export function serverClient(baseUrl: string, secret: string): ServerClient {
  const base = baseUrl.replace(/\/+$/, "");
  async function post(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  }
  return {
    async claim(body) {
      const { status, json } = await post("/api/internal/insight/claim", body);
      if (status !== 200 || !json || typeof json !== "object") {
        const why = (json as { error?: string } | null)?.error ?? `HTTP ${status}`;
        throw new Error(`The claim was refused: ${why}`);
      }
      return json as ClaimAnswer;
    },
    async event(scanId, body) {
      const { status, json } = await post(`/api/internal/insight/scans/${scanId}/events`, body);
      if (json && typeof json === "object" && "ok" in json) return json as EventAnswer;
      return { ok: false, status, error: `The server answered HTTP ${status} without a body it could read.`, stop: status === 401 || status === 404 };
    },
  };
}
