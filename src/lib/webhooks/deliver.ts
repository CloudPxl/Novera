import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { open, seal } from "../crypto.ts";
import { assertPublicUrl, publicOnlyDispatcher, refusedAddress } from "../net/public-url.ts";
import { SIGNATURE_HEADER, signatureFor } from "./sign.ts";
import { pipelineOutcome } from "../report/outcome.ts";
import type { ReportPayload } from "../report/payload.ts";
import { discardBody } from "../net/read-body.ts";

/**
 * Outbound webhooks (0042): minting an endpoint, queueing an event, delivering it.
 *
 * A delivery is attempted at once and, if that fails, again by the clock with a
 * growing wait, until it succeeds or has been tried six times. What is sent is frozen
 * when the event is queued; what moves is only whether it arrived. The body carries
 * counts, the outcome and links — never a transcript, a reply, a policy or a secret.
 *
 * At least once, not exactly once: each attempt is claimed by one sender (0046), but a
 * sender can die after the receiver accepted and before recording it, and the attempt is
 * then made again. Receivers ignore a repeat by its `Novera-Delivery` id.
 */

export const WEBHOOK_EVENTS = ["run.completed", "run.stopped", "schedule.paused"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const DELIVERY_TIMEOUT_MS = 5_000;
/** Waits after each failed attempt; after the last, the delivery is given up as failed. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000];

const aad = (endpointId: string) => `novera:webhook:${endpointId}`;

export async function createEndpoint(args: {
  db: SupabaseClient; workspaceId: string; url: string; events: WebhookEvent[]; createdBy: string;
}): Promise<{ id: string; secret: string }> {
  const id = crypto.randomUUID();
  const secret = `whsec_${randomBytes(32).toString("base64url")}`;
  const sealed = seal(secret, aad(id));
  const { error } = await args.db.from("webhook_endpoints").insert({
    id, workspace_id: args.workspaceId, url: args.url, events: args.events,
    secret_prefix: secret.slice(0, 12), secret_ciphertext: sealed.ciphertext, secret_iv: sealed.iv, secret_tag: sealed.tag,
    created_by: args.createdBy,
  });
  if (error) throw new Error(`The endpoint could not be saved: ${error.message}`);
  return { id, secret };
}

/**
 * Queues an event for every live endpoint in the workspace that asked for it. Once per
 * endpoint, event and subject (a unique index): a run announced by two slices is sent
 * once. Returns the ids queued.
 */
export async function enqueue(args: {
  db: SupabaseClient; workspaceId: string; event: WebhookEvent | "test"; subjectId: string | null; body: Record<string, unknown>;
  onlyEndpoint?: string;
}): Promise<string[]> {
  let q = args.db.from("webhook_endpoints").select("id, events")
    .eq("workspace_id", args.workspaceId).is("revoked_at", null);
  if (args.onlyEndpoint) q = q.eq("id", args.onlyEndpoint);
  const { data: endpoints } = await q;
  const targets = (endpoints ?? []).filter((e) => args.event === "test" || (e.events as string[]).includes(args.event));
  if (!targets.length) return [];
  const { data } = await args.db.from("webhook_deliveries").upsert(
    targets.map((e) => ({
      workspace_id: args.workspaceId, endpoint_id: e.id, event: args.event, subject_id: args.subjectId,
      body: { event: args.event, created_at: new Date().toISOString(), ...args.body },
    })),
    { onConflict: "endpoint_id,event,subject_id", ignoreDuplicates: true },
  ).select("id");
  return (data ?? []).map((d) => d.id as string);
}

/**
 * How long a claimed attempt is held before another sender may take it over: well past the
 * request's own deadline, so a takeover means the first sender died, not that it was slow.
 */
const LEASE_SECONDS = 30;

type Endpoint = { url: string; revoked_at: string | null; secret_ciphertext: string; secret_iv: string; secret_tag: string };

/**
 * Sends due deliveries — the given ones, or any that are due — within the time given.
 *
 * Each attempt is claimed first (0046): one statement takes a lease, a token and counts
 * the attempt, so of several senders at once exactly one sends, and the outcome is
 * recorded only while that token stands. One row at a time, so a sweep that runs out of
 * time never counts an attempt it did not make. Delivery is at-least-once: a sender that
 * dies after the receiver accepted leaves the row to be retried when its lease runs out.
 */
export async function deliverDue(args: {
  db: SupabaseClient; ids?: string[]; deadline: number; limit?: number;
}): Promise<{ delivered: number; failed: number; retrying: number }> {
  const out = { delivered: 0, failed: 0, retrying: 0 };
  // Named deliveries still to try in this call: each at most once, whatever happens to it.
  const remaining = args.ids ? [...args.ids] : null;
  if (remaining && remaining.length === 0) return out;

  for (let n = 0; n < (args.limit ?? 20); n++) {
    if (remaining && remaining.length === 0) break;
    if (Date.now() + DELIVERY_TIMEOUT_MS > args.deadline) break;
    // Named deliveries are attempted now; only the clock's sweep asks what is due, and it
    // asks the database's clock, in the claim.
    const { data: claimed, error: claimError } = await args.db.rpc("claim_webhook_deliveries", {
      only_ids: remaining, max_rows: 1, lease_seconds: LEASE_SECONDS,
    });
    if (claimError) {
      console.error(`Webhook deliveries could not be claimed: ${claimError.message}`);
      break;
    }
    const d = (claimed as Array<{ id: string; lease_token: string; attempts: number; event: string; body: unknown; endpoint_id: string }> | null)?.[0];
    if (!d) break;
    if (remaining) remaining.splice(remaining.indexOf(d.id), 1);

    // Recorded only while this sender's claim stands: one that outlived its lease never
    // overwrites the sender that took over.
    const settle = async (patch: Record<string, unknown>) => {
      const { data } = await args.db.from("webhook_deliveries")
        .update({ ...patch, lease_token: null, lease_until: null })
        .eq("id", d.id).eq("lease_token", d.lease_token).eq("status", "pending").select("id");
      return (data ?? []).length === 1;
    };
    const { data: ep } = await args.db.from("webhook_endpoints")
      .select("url, revoked_at, secret_ciphertext, secret_iv, secret_tag").eq("id", d.endpoint_id).maybeSingle<Endpoint>();
    const fail = async (lastStatus: number | null, why: string, giveUp = false) => {
      const final = giveUp || d.attempts > BACKOFF_MS.length || !ep || ep.revoked_at !== null;
      const kept = await settle({
        last_status: lastStatus, last_error: why.slice(0, 300),
        ...(final ? { status: "failed" } : { next_attempt_at: new Date(Date.now() + BACKOFF_MS[d.attempts - 1]).toISOString() }),
      });
      if (kept) { if (final) out.failed++; else out.retrying++; }
    };

    if (!ep || ep.revoked_at) { await fail(null, "The endpoint was revoked."); continue; }
    try {
      await assertPublicUrl(ep.url);
    } catch (e) {
      await fail(null, `Not sent: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    const body = JSON.stringify(d.body);
    let secret: string;
    try {
      secret = open({ ciphertext: ep.secret_ciphertext, iv: ep.secret_iv, tag: ep.secret_tag }, aad(d.endpoint_id));
    } catch {
      // A secret sealed under another key never opens; retrying cannot help, and it must
      // not hold up any other delivery.
      await fail(null, "Not sent: the endpoint's signing secret could not be opened. Remove the endpoint and add it again.", true);
      continue;
    }
    try {
      const res = await fetch(ep.url, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        dispatcher: publicOnlyDispatcher(),
        headers: {
          "content-type": "application/json",
          "user-agent": "Novera-Webhooks/1",
          "novera-event": d.event,
          "novera-delivery": d.id,
          [SIGNATURE_HEADER]: signatureFor(secret, body, Math.floor(Date.now() / 1000)),
        },
        body,
      } as RequestInit);
      // Only the status is read. The receiver's body is released unread: whatever it says, at
      // whatever size, is not ours to store, and an unread body would hold its connection.
      await discardBody(res);
      if (res.status >= 200 && res.status < 300) {
        if (await settle({ status: "delivered", last_status: res.status, last_error: null, delivered_at: new Date().toISOString() })) out.delivered++;
      } else {
        await fail(res.status, res.status >= 300 && res.status < 400 ? `Answered ${res.status}; redirects are not followed.` : `Answered ${res.status}.`);
      }
    } catch (e) {
      const refused = refusedAddress(e);
      await fail(null, refused ? `Not sent: ${refused}`
        : e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? `No answer within ${DELIVERY_TIMEOUT_MS / 1000} s.` : `Could not connect: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

/** What a finished run's webhook says: counts and links from stored rows, nothing more. */
export async function runEventBody(db: SupabaseClient, workspaceId: string, runId: string, origin: string): Promise<{ event: WebhookEvent; body: Record<string, unknown> } | null> {
  const [{ data: run }, { data: cases }, { data: report }] = await Promise.all([
    db.from("runs").select("id, status, error, stopped_by, created_at, finished_at, schedule_id, agents(id, name), suites(key, version)")
      .eq("workspace_id", workspaceId).eq("id", runId).maybeSingle(),
    db.from("run_cases").select("status").eq("workspace_id", workspaceId).eq("run_id", runId),
    db.from("reports").select("token, content_hash, payload").eq("workspace_id", workspaceId).eq("run_id", runId).is("revoked_at", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!run || (run.status !== "completed" && run.status !== "aborted")) return null;
  const count = (s: string) => (cases ?? []).filter((c) => c.status === s).length;
  const passed = count("pass"), failed = count("fail"), noResult = count("error");
  const agent = run.agents as unknown as { id: string; name: string } | null;
  const suite = run.suites as unknown as { key: string; version: number } | null;
  // What the sealed report supports, decided where the CLI and the exports decide it. No
  // report means the evidence did not support one: never a pass.
  const outcome = pipelineOutcome(run, report?.payload as ReportPayload | null);
  return {
    event: run.status === "completed" ? "run.completed" : "run.stopped",
    body: {
      run: {
        id: run.id, status: run.status, started_by_schedule: Boolean(run.schedule_id),
        agent: agent ? { id: agent.id, name: agent.name } : null,
        suite: suite ? `${suite.key} v${suite.version}` : null,
        created_at: run.created_at, finished_at: run.finished_at,
        counts: { passed, failed, no_result: noResult },
        outcome,
        ...(run.status === "aborted" ? { reason: abortedReason(run) } : {}),
        url: `${origin}/runs/${run.id}`,
        report: report ? { url: `${origin}/report/${report.token}`, content_hash: report.content_hash } : null,
      },
    },
  };
}

/**
 * Why a run ended early, as one of three fixed sentences. The run's own error text is for the
 * workspace — the Stop button writes the person's email address into it, and a failure can
 * carry an agent's or the database's words — while a webhook goes to a third party's system
 * (audit R7: the stopper's email reached the receiver). The run page keeps the full text.
 */
export function abortedReason(run: { error: string | null; stopped_by: string | null }): string {
  if (run.stopped_by) return "Stopped by a member of the workspace before it finished.";
  if (/no scenario was graded for 24 hours/.test(run.error ?? "")) return "Stopped because no scenario was graded for 24 hours.";
  return "Ended by an error outside any scenario; the run page says what happened.";
}

/** The app's public origin, for links in a webhook body. */
export function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.nover.space").replace(/\/+$/, "");
}

/**
 * Announces a finished run to the workspace's endpoints and tries to deliver at once.
 * Never throws: telling someone about a run must not be able to break the run.
 */
export async function notifyRunFinished(db: SupabaseClient, workspaceId: string, runId: string, deadline: number): Promise<void> {
  try {
    const built = await runEventBody(db, workspaceId, runId, appOrigin());
    if (!built) return;
    const ids = await enqueue({ db, workspaceId, event: built.event, subjectId: runId, body: built.body });
    if (ids.length) await deliverDue({ db, ids, deadline });
  } catch {
    // Left pending, if it was queued at all; the clock retries.
  }
}

/**
 * Queues the announcements a finishing slice never made — it was killed between marking the
 * run finished and queueing the event — and those of runs ended by the stalled-run pass,
 * which runs in the database (0051). Called by the clock; the sweep after it delivers them.
 * The unique index keeps a run announced once per endpoint however often this runs.
 */
export async function announceMissedRuns(db: SupabaseClient, deadline: number): Promise<number> {
  const { data, error } = await db.rpc("runs_awaiting_announcement", { max_rows: 20 });
  if (error) {
    console.error(`Missed run announcements could not be listed: ${error.message}`);
    return 0;
  }
  // Only to the endpoints that missed it: an endpoint added after the run finished is not
  // sent the workspace's history.
  const byRun = new Map<string, { workspaceId: string; endpoints: string[] }>();
  for (const row of (data ?? []) as Array<{ workspace_id: string; run_id: string; endpoint_id: string }>) {
    const entry = byRun.get(row.run_id) ?? { workspaceId: row.workspace_id, endpoints: [] };
    entry.endpoints.push(row.endpoint_id);
    byRun.set(row.run_id, entry);
  }
  let queued = 0;
  for (const [runId, { workspaceId, endpoints }] of byRun) {
    if (Date.now() > deadline) break;
    const built = await runEventBody(db, workspaceId, runId, appOrigin());
    if (!built) continue;
    for (const endpoint of endpoints) {
      queued += (await enqueue({ db, workspaceId, event: built.event, subjectId: runId, body: built.body, onlyEndpoint: endpoint })).length;
    }
  }
  return queued;
}

/** Announces a paused schedule. Never throws, for the same reason. */
export async function notifySchedulePaused(db: SupabaseClient, workspaceId: string, schedule: { id: string; reason: string; agentId: string }, deadline: number): Promise<void> {
  try {
    const ids = await enqueue({
      db, workspaceId, event: "schedule.paused", subjectId: schedule.id,
      body: { schedule: { id: schedule.id, reason: schedule.reason, url: `${appOrigin()}/agents/${schedule.agentId}` } },
    });
    if (ids.length) await deliverDue({ db, ids, deadline });
  } catch {
    // As above.
  }
}
