import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { advanceRun, RunRefusal, startRun } from "../workflow/start-run.ts";
import { announceMissedRuns, deliverDue, notifyRunFinished, notifySchedulePaused } from "../webhooks/deliver.ts";
import { RESEAL_AFTER_MS, RESEAL_FROM, sealCompletedRun } from "../workflow/execute-run.ts";
import { nextOccurrence, type ScheduleTiming } from "./cadence.ts";

/**
 * One tick of the schedule clock: start what is due, then move scheduled runs forward.
 *
 * Runs start through `startRun` and advance through `advanceRun`, exactly as the button
 * and the API do — a schedule is a different caller, not a different run.
 */

/** Below this, a slice would grade too little to be worth the lease. */
const MIN_SLICE_MS = 12_000;
const MAX_DUE_PER_TICK = 20;
const MAX_ADVANCED_PER_TICK = 10;

/**
 * Takes items in order, but one workspace at a time: the first of each workspace, then
 * the second of each, and so on, up to `limit`. Oldest-first alone let one workspace with
 * many schedules or long runs take every slot a tick has.
 */
export function roundRobin<T>(items: T[], workspaceOf: (item: T) => string, limit: number): T[] {
  const queues = new Map<string, T[]>();
  for (const item of items) {
    const key = workspaceOf(item);
    queues.set(key, [...(queues.get(key) ?? []), item]);
  }
  const out: T[] = [];
  for (let round = 0; out.length < limit; round++) {
    let took = false;
    for (const queue of queues.values()) {
      if (round < queue.length && out.length < limit) { out.push(queue[round]); took = true; }
    }
    if (!took) break;
  }
  return out;
}

/** How many candidates a tick reads before choosing fairly among them. */
const CANDIDATES = 60;

export interface TickReport {
  due: number;
  started: number;
  skipped: number;
  paused: number;
  failed: number;
  advanced: number;
  finished: number;
  /** Webhook deliveries retried by this tick that arrived. */
  delivered: number;
  /** Completed runs whose missing report this tick sealed. */
  sealed?: number;
}

/** How far back the sweep looks for a completed run with no report, and how many it seals per tick. */
const RESEAL_LOOKBACK_MS = 3 * 86_400_000;
const RESEAL_CANDIDATES = 100;
const MAX_SEALED_PER_TICK = 3;

/**
 * Seals the reports completed runs never got (final audit follow-up 3, 2026-10-29) — the slice
 * that completed a run failed or was killed before storing its report. `sealCompletedRun` did
 * this only when someone advanced the run again, so a scheduled run, which nobody opens, stayed
 * unsealed and unannounced. Bounded: runs finished between `RESEAL_AFTER_MS` and three days ago
 * (and not before `RESEAL_FROM`), newest first, a few per tick. A run with nothing graded or an
 * exploratory scan is passed over by `sealCompletedRun` without a write.
 */
export async function sealMissedReports(args: { client: SupabaseClient; deadline: number; now?: Date }): Promise<number> {
  const { client, deadline } = args;
  const now = (args.now ?? new Date()).getTime();
  const from = new Date(Math.max(now - RESEAL_LOOKBACK_MS, Date.parse(RESEAL_FROM))).toISOString();
  const { data: finished } = await client.from("runs").select("id, workspace_id")
    .eq("status", "completed")
    .gte("finished_at", from).lte("finished_at", new Date(now - RESEAL_AFTER_MS).toISOString())
    .order("finished_at", { ascending: false }).limit(RESEAL_CANDIDATES);
  if (!finished?.length) return 0;
  const { data: reports } = await client.from("reports").select("run_id").in("run_id", finished.map((r) => r.id as string));
  const sealedRuns = new Set((reports ?? []).map((r) => r.run_id as string));

  let sealed = 0;
  for (const r of finished.filter((x) => !sealedRuns.has(x.id as string))) {
    if (sealed >= MAX_SEALED_PER_TICK || Date.now() > deadline - 8_000) break;
    try {
      if (await sealCompletedRun({ client, workspaceId: r.workspace_id as string, runId: r.id as string, now })) {
        sealed += 1;
        await notifyRunFinished(client, r.workspace_id as string, r.id as string, Math.min(deadline, Date.now() + 8_000));
      }
    } catch (thrown) {
      console.error(`Run ${r.id}: its report could not be sealed: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
    }
  }
  return sealed;
}

interface ScheduleRow {
  id: string;
  workspace_id: string;
  agent_id: string;
  suite_id: string;
  cadence: ScheduleTiming["cadence"];
  hour_utc: number;
  weekday: number | null;
  next_run_at: string;
  created_by: string;
}

export async function runScheduleTick(args: {
  client: SupabaseClient;
  /** When this invocation must hand back by (epoch ms). */
  deadline: number;
  now?: Date;
}): Promise<TickReport> {
  const { client, deadline } = args;
  const now = args.now ?? new Date();
  const report: TickReport = { due: 0, started: 0, skipped: 0, paused: 0, failed: 0, advanced: 0, finished: 0, delivered: 0 };

  const { data: due } = await client
    .from("run_schedules")
    .select("id, workspace_id, agent_id, suite_id, cadence, hour_utc, weekday, next_run_at, created_by")
    .lte("next_run_at", now.toISOString())
    .is("paused_at", null).is("cancelled_at", null)
    .order("next_run_at").limit(CANDIDATES);

  for (const s of roundRobin((due ?? []) as ScheduleRow[], (x) => x.workspace_id, MAX_DUE_PER_TICK)) {
    report.due += 1;
    const next = nextOccurrence({ cadence: s.cadence, hourUtc: s.hour_utc, weekday: s.weekday }, now);

    // Claim by moving the clock forward, conditional on it not having moved: of two
    // overlapping ticks exactly one gets the row back, so a schedule starts once.
    const { data: claimed } = await client
      .from("run_schedules")
      .update({ next_run_at: next.toISOString(), last_attempt_at: now.toISOString() })
      .eq("id", s.id).eq("next_run_at", s.next_run_at)
      .is("paused_at", null).is("cancelled_at", null)
      .select("id");
    if (!claimed?.length) continue;

    const outcome = await startScheduled(client, s);
    report[outcome.kind] += 1;
    await client.from("run_schedules").update(outcome.update).eq("id", s.id).is("cancelled_at", null);
    if (outcome.kind === "paused") {
      await notifySchedulePaused(client, s.workspace_id, {
        id: s.id, agentId: s.agent_id, reason: String(outcome.update.paused_reason ?? ""),
      }, Math.min(deadline, Date.now() + 8_000));
    }
  }

  // Oldest first within a workspace, one workspace at a time across them.
  const { data: inFlight } = await client
    .from("runs").select("id, workspace_id")
    .not("schedule_id", "is", null).in("status", ["queued", "running"])
    .order("created_at").limit(CANDIDATES);

  for (const r of roundRobin(inFlight ?? [], (x) => x.workspace_id as string, MAX_ADVANCED_PER_TICK)) {
    const left = deadline - Date.now();
    if (left < MIN_SLICE_MS) break;
    const result = await advanceRun({
      client, workspaceId: r.workspace_id as string, runId: r.id as string, budgetMs: left - 3_000,
    });
    if (result?.started) report.advanced += 1;
    if (result?.started && result.done) report.finished += 1;
  }

  if (deadline - Date.now() > 10_000) report.sealed = await sealMissedReports({ client, deadline: deadline - 2_000, now });

  // Webhook deliveries that failed their first attempt, retried with whatever time is
  // left. Their own backoff decides which are due.
  if (deadline - Date.now() > 6_000) {
    // First the runs whose announcement was never queued (0051), so this sweep sends them too.
    await announceMissedRuns(client, deadline - 6_000);
    const retried = await deliverDue({ db: client, deadline: deadline - 1_000 });
    report.delivered = retried.delivered;
  }

  return report;
}

type Outcome =
  | { kind: "started"; update: Record<string, unknown> }
  | { kind: "skipped"; update: Record<string, unknown> }
  | { kind: "paused"; update: Record<string, unknown> }
  | { kind: "failed"; update: Record<string, unknown> };

async function startScheduled(client: SupabaseClient, s: ScheduleRow): Promise<Outcome> {
  // One at a time. A run still going when the next is due is not joined by a second
  // one grading the same agent; the occurrence is skipped and says so.
  const { data: busy } = await client
    .from("runs").select("id").eq("schedule_id", s.id).in("status", ["queued", "running"]).limit(1);
  if (busy?.length) {
    return { kind: "skipped", update: { last_outcome: "Skipped: the previous scheduled run was still in progress." } };
  }

  try {
    await startRun({
      client, workspaceId: s.workspace_id, userId: s.created_by,
      agentId: s.agent_id, suiteId: s.suite_id, scheduleId: s.id,
    });
    return { kind: "started", update: { last_outcome: "Started." } };
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    if (thrown instanceof RunRefusal && thrown.blocker === "concurrency") {
      // Runs already in flight finish on their own: this occurrence is skipped, not the
      // schedule paused, and the next one starts as usual.
      return { kind: "skipped", update: { last_outcome: `Skipped: ${message}` } };
    }
    if (thrown instanceof RunRefusal) {
      // A refusal will be the same refusal tomorrow — no runs left, no policy. Pause
      // with the reason rather than failing silently every day.
      return {
        kind: "paused",
        update: { paused_at: new Date().toISOString(), paused_reason: message, last_outcome: `Paused: ${message}` },
      };
    }
    return { kind: "failed", update: { last_outcome: `Could not start: ${message}` } };
  }
}
