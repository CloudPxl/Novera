import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { advanceRun, RunRefusal, startRun } from "../workflow/start-run.ts";
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

export interface TickReport {
  due: number;
  started: number;
  skipped: number;
  paused: number;
  failed: number;
  advanced: number;
  finished: number;
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
  const report: TickReport = { due: 0, started: 0, skipped: 0, paused: 0, failed: 0, advanced: 0, finished: 0 };

  const { data: due } = await client
    .from("run_schedules")
    .select("id, workspace_id, agent_id, suite_id, cadence, hour_utc, weekday, next_run_at, created_by")
    .lte("next_run_at", now.toISOString())
    .is("paused_at", null).is("cancelled_at", null)
    .order("next_run_at").limit(MAX_DUE_PER_TICK);

  for (const s of (due ?? []) as ScheduleRow[]) {
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
  }

  // Oldest first, so a run that has waited longest is the one that moves.
  const { data: inFlight } = await client
    .from("runs").select("id, workspace_id")
    .not("schedule_id", "is", null).in("status", ["queued", "running"])
    .order("created_at").limit(MAX_ADVANCED_PER_TICK);

  for (const r of inFlight ?? []) {
    const left = deadline - Date.now();
    if (left < MIN_SLICE_MS) break;
    const result = await advanceRun({
      client, workspaceId: r.workspace_id as string, runId: r.id as string, budgetMs: left - 3_000,
    });
    if (result?.started) report.advanced += 1;
    if (result?.started && result.done) report.finished += 1;
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
