import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Idempotency-Key for starting a run (0049).
 *
 * A pipeline that times out and retries must get the run it already started, not a second
 * one. The key is claimed before the run exists, together with the id the run will be
 * created with, so a retry finds either that run or proof that it never started — there
 * is no moment at which a crash could leave a run that no claim names.
 *
 * Scoped to the workspace; honoured for 24 hours; a different request under the same key
 * is refused, never run. Authorisation and the trial cap still apply to the request that
 * starts the run: a key decides only whether a request is a repeat.
 */

export const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,200}$/;
const VALID_FOR_MS = 24 * 3_600_000;
/** A claim whose run has not appeared after this long was left by a request that died. */
const ABANDONED_AFTER_MS = 60_000;
const WAIT_MS = 500;
const WAITS = 20;

export type Claim =
  | { kind: "new"; runId: string }
  | { kind: "replay"; runId: string }
  | { kind: "conflict" }
  | { kind: "in_progress" };

/** What the request asked for — the fields that decide what run it starts. */
export function requestHash(request: { agentId: string; suiteId: string | null; releaseId?: string; knowledgeBaseRevision?: string }): string {
  const canonical = JSON.stringify([request.agentId, request.suiteId ?? null, request.releaseId ?? null, request.knowledgeBaseRevision ?? null]);
  return createHash("sha256").update(canonical).digest("hex");
}

export async function claimRunRequest(db: SupabaseClient, workspaceId: string, key: string, hash: string): Promise<Claim> {
  // Keys older than a day are no longer honoured; their claims go with this workspace's next one.
  await db.from("run_requests").delete().eq("workspace_id", workspaceId).lt("created_at", new Date(Date.now() - VALID_FOR_MS).toISOString());

  const runId = randomUUID();
  for (let i = 0; i < WAITS; i++) {
    const { error } = await db.from("run_requests").insert({ workspace_id: workspaceId, idempotency_key: key, request_hash: hash, run_id: runId });
    if (!error) return { kind: "new", runId };
    if (error.code !== "23505") throw new Error(`The Idempotency-Key could not be recorded: ${error.message}`);

    const { data: existing } = await db.from("run_requests").select("request_hash, run_id, created_at")
      .eq("workspace_id", workspaceId).eq("idempotency_key", key).maybeSingle();
    if (!existing) continue; // its start was refused and the claim removed: claim it now
    if (existing.request_hash !== hash) return { kind: "conflict" };

    const { data: run } = await db.from("runs").select("id").eq("id", existing.run_id).eq("workspace_id", workspaceId).maybeSingle();
    if (run) return { kind: "replay", runId: existing.run_id as string };

    if (Date.now() - Date.parse(existing.created_at as string) > ABANDONED_AFTER_MS) {
      // Claimed and never started: the request that claimed it died. Remove exactly that claim.
      await db.from("run_requests").delete().eq("workspace_id", workspaceId).eq("idempotency_key", key).eq("run_id", existing.run_id);
      continue;
    }
    await new Promise((r) => setTimeout(r, WAIT_MS)); // another request is starting it now
  }
  return { kind: "in_progress" };
}

/** A start that was refused leaves no claim, so the same key can be used once the reason is gone. */
export async function releaseClaim(db: SupabaseClient, workspaceId: string, key: string, runId: string): Promise<void> {
  await db.from("run_requests").delete().eq("workspace_id", workspaceId).eq("idempotency_key", key).eq("run_id", runId);
}
