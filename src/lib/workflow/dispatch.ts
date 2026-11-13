import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdvanceResult } from "./start-run.ts";

/**
 * Starting the next slice from the server (2026-11-13).
 *
 * Until now a run moved only while something asked for it: its open page every fifteen seconds,
 * an API caller, or the schedule clock for a scheduled run. A browser slows the timers of a tab in
 * the background, so three runs open in three tabs advanced at the pace of the one in front, and
 * a run whose tab closed stopped. Now a slice that hands back asks for the next one itself, and
 * for the head of the queue (0087's `next_waiting_run`) when it frees a grading slot.
 *
 * The request goes to this deployment's own `/api/runs/[id]/continue`, which answers at once and
 * runs the slice after answering (`after`, inside its 60 s). It carries a bearer token bound to the
 * run: an HMAC of the run id under a key derived from NOVERA_ENCRYPTION_KEY, so a token for one run
 * opens no other and no table holds it. Every slice still goes through `advanceRun` and its lease:
 * a dispatch that arrives while another slice holds the run, or while the queue says wait, does
 * nothing and asks for nothing more. Nothing here can make a run go faster than its claim allows.
 */

function dispatchKey(raw = process.env.NOVERA_ENCRYPTION_KEY): string | null {
  return raw ? createHmac("sha256", `${raw}:run-dispatch:v1`).update("novera-run-dispatch").digest("base64url") : null;
}

/** The bearer token for one run's continue request; null when the deployment has no key. */
export function dispatchToken(runId: string, raw?: string): string | null {
  const key = dispatchKey(raw);
  return key ? createHmac("sha256", key).update(runId).digest("base64url") : null;
}

/** Whether an `Authorization` header carries this run's token. Constant time. */
export function isDispatchRequest(header: string | null, runId: string, raw?: string): boolean {
  const match = /^Bearer\s+(\S+)\s*$/.exec(header ?? "");
  const expected = dispatchToken(runId, raw);
  if (!match || !expected) return false;
  const a = Buffer.from(match[1]);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** How long to wait for the continue route to accept. It answers before it works. */
const ACCEPT_TIMEOUT_MS = 5_000;

/** Asks this deployment to run one slice of a run. True when the request was accepted. */
export async function dispatchSlice(origin: string, runId: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const token = dispatchToken(runId);
  if (!token || !/^https?:\/\/[^/]+$/.test(origin)) return false;
  try {
    const response = await fetcher(`${origin}/api/runs/${encodeURIComponent(runId)}/continue`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(ACCEPT_TIMEOUT_MS),
    });
    return response.status === 202;
  } catch {
    return false;
  }
}

/**
 * What a finished slice asks for next: its own run's next slice when it is not done, and the head
 * of the waiting line when it held a slot that is now free. A slice that did not start asks for
 * nothing, so a refused dispatch never becomes a loop.
 */
export async function chainAfterSlice(args: {
  client: SupabaseClient;
  origin: string;
  runId: string;
  result: AdvanceResult | null;
  dispatch?: (origin: string, runId: string) => Promise<boolean>;
}): Promise<string[]> {
  const { client, origin, runId, result } = args;
  const dispatch = args.dispatch ?? dispatchSlice;
  const asked: string[] = [];
  if (!result?.started) return asked;
  if (!result.done && await dispatch(origin, runId)) asked.push(runId);
  try {
    const { data } = await client.rpc("next_waiting_run");
    const head = Array.isArray(data) ? (data[0] as { run_id?: string } | undefined)?.run_id : undefined;
    if (head && head !== runId && await dispatch(origin, head)) asked.push(head);
  } catch { /* 0087 not applied: the waiting run's own page or caller still asks for it */ }
  return asked;
}
