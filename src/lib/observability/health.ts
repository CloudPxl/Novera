import { serviceClient } from "../supabase/service.ts";
import { connectionsFromEnv } from "../providers/registry.ts";
import { DEFAULT_ROUTES } from "../router/routes.ts";

/**
 * The one health check. `/api/health` serves it as JSON and `/status` renders it, so the two
 * cannot disagree and there is one place to change what "degraded" means.
 *
 * It is public, so it answers with words, never with numbers that describe the platform:
 *
 *   database  reachable within the deadline (and how long that took: one latency figure)
 *   runner    no run has sat in `queued`/`running` for more than 15 minutes without progress
 *   grading   at least two distinct grading vendors are configured (no names, no count)
 *
 * No run count, no queue depth, no vendor name, no environment value, no table name, no error
 * text and no stack ever appears in the result. Every failure becomes a status word.
 *
 * `down` only ever means the database did not answer. A stalled runner or a missing second
 * vendor is `degraded`: evidence is still readable and the product still tells the truth about
 * what it could not do (an incomplete run is never sealed; a single vendor is labelled).
 *
 * The answer is reused for 30 seconds per function instance, and concurrent callers share one
 * in-flight check, so polling it is not load on the database.
 */

export type Level = "ok" | "degraded" | "down";

export interface HealthReport {
  /** Always true when this answers at all. Kept from the first version of the endpoint. */
  app: true;
  /** Kept from the first version of the endpoint. */
  database: boolean;
  status: Level;
  checked_at: string;
  checks: {
    database: { status: Level; latency_ms: number };
    runner: { status: Level };
    grading: { status: Level };
  };
}

/** What the check needs from the outside world; replaced in tests. */
export interface HealthProbe {
  /** True when the database answered within its deadline. */
  databaseReachable(): Promise<boolean>;
  /** True when a run has been queued or running for over the stall window with no progress. Throws when it cannot be told. */
  runStalled(now: number): Promise<boolean>;
}

export const DATABASE_DEADLINE_MS = 1_500;
export const CACHE_MS = 30_000;
/** A run in progress with no new case, lease or start for this long is stalled. */
export const STALL_MS = 15 * 60_000;

/** How many distinct grading vendors this server holds a key for, among those the judge route can use. */
export function gradingVendorCount(env: Record<string, string | undefined>): number {
  const usable = new Set(DEFAULT_ROUTES.judge.map((c) => c.connection));
  let held = 0;
  for (const name of connectionsFromEnv(env as NodeJS.ProcessEnv).keys()) if (usable.has(name)) held++;
  return held;
}

/** Status words only: the number of vendors is not published. */
export function gradingLevel(env: Record<string, string | undefined>): Level {
  return gradingVendorCount(env) >= 2 ? "ok" : "degraded";
}

export async function checkHealth(
  deps: { probe?: HealthProbe; env?: Record<string, string | undefined>; now?: () => number } = {},
): Promise<HealthReport> {
  const probe = deps.probe ?? supabaseProbe();
  const env = deps.env ?? process.env;
  const clock = deps.now ?? Date.now;
  const started = clock();

  let databaseUp = false;
  try {
    databaseUp = await probe.databaseReachable();
  } catch {
    databaseUp = false;
  }
  const latency = Math.max(0, Math.round(clock() - started));

  let runner: Level = "down";
  if (databaseUp) {
    try {
      runner = (await probe.runStalled(clock())) ? "degraded" : "ok";
    } catch {
      // Could not be told while the database answers: not a green light.
      runner = "degraded";
    }
  }

  let grading: Level;
  try {
    grading = gradingLevel(env);
  } catch {
    grading = "degraded";
  }

  const status: Level = !databaseUp ? "down" : runner !== "ok" || grading !== "ok" ? "degraded" : "ok";
  return {
    app: true,
    database: databaseUp,
    status,
    checked_at: new Date(clock()).toISOString(),
    checks: {
      database: { status: databaseUp ? "ok" : "down", latency_ms: latency },
      runner: { status: runner },
      grading: { status: grading },
    },
  };
}

/** The real probe: two small reads through the service client, each bounded by the deadline. */
export function supabaseProbe(): HealthProbe {
  return {
    async databaseReachable() {
      try {
        const { error } = await serviceClient()
          .from("suites").select("id", { count: "exact", head: true }).is("workspace_id", null)
          .abortSignal(AbortSignal.timeout(DATABASE_DEADLINE_MS));
        return !error;
      } catch {
        return false;
      }
    },
    async runStalled(now) {
      const db = serviceClient();
      const cutoffMs = now - STALL_MS;
      const cutoff = new Date(cutoffMs).toISOString();
      const open = await db.from("runs")
        .select("id, created_at, started_at, lease_until")
        .in("status", ["queued", "running"])
        .lt("created_at", cutoff)
        .limit(50)
        .abortSignal(AbortSignal.timeout(DATABASE_DEADLINE_MS));
      if (open.error) throw new Error("runs unreadable");
      const quiet = (open.data ?? []).filter((r: { started_at: string | null; lease_until: string | null }) =>
        (!r.started_at || Date.parse(r.started_at) < cutoffMs) && (!r.lease_until || Date.parse(r.lease_until) < cutoffMs));
      if (quiet.length === 0) return false;
      const recent = await db.from("run_cases")
        .select("run_id")
        .in("run_id", quiet.map((r: { id: string }) => r.id))
        .gte("created_at", cutoff)
        .limit(500)
        .abortSignal(AbortSignal.timeout(DATABASE_DEADLINE_MS));
      if (recent.error) throw new Error("cases unreadable");
      const moving = new Set((recent.data ?? []).map((c: { run_id: string }) => c.run_id));
      return quiet.some((r: { id: string }) => !moving.has(r.id));
    },
  };
}

let cached: { report: HealthReport; at: number } | null = null;
let inFlight: Promise<HealthReport> | null = null;

/** The report for this instant, reused for 30 seconds, one check in flight at a time. */
export async function getHealth(now: number = Date.now()): Promise<HealthReport> {
  if (cached && now - cached.at <= CACHE_MS) return cached.report;
  inFlight ??= checkHealth().then((report) => {
    cached = { report, at: Date.now() };
    return report;
  }).finally(() => { inFlight = null; });
  return inFlight;
}

/** For tests: forget the reused answer. */
export function resetHealthCache(): void {
  cached = null;
  inFlight = null;
}

export const OVERALL_SENTENCE: Record<Level, string> = {
  ok: "All systems operational",
  degraded: "Partial degradation",
  down: "Service disruption",
};
