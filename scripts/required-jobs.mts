/**
 * The scheduled jobs Novera's guarantees depend on, and how to tell whether a database has
 * them. Shared by `npm run verify:cron` and `npm run migrate`.
 *
 * The three daily jobs are created by migrations 0037, 0038 and 0040 — but only when pg_cron
 * is already installed; without it those migrations apply cleanly and create nothing, so a
 * new or restored database can lose raw-evidence expiry, probe and inbox expiry and the
 * stalled-run stop in silence (audit 2026-09-30, R1). The clock that starts scheduled runs and
 * retries webhooks is installed by `npm run schedules:clock -- install`, never by a migration.
 * The migrations stay as they are (applied files are never edited); this is how a deployment
 * finds out.
 */

export interface RequiredJob {
  name: string;
  schedule: string;
  /** A fragment the job's command must contain. */
  command: string;
  /** How long since the last successful run before the job counts as not running. */
  maxAgeMinutes: number;
  why: string;
  fix: string;
}

const daily = (name: string, schedule: string, fn: string, migration: string, why: string): RequiredJob => ({
  name, schedule, command: `${fn}()`, maxAgeMinutes: 26 * 60, why,
  fix: `Enable pg_cron (Supabase dashboard → Database → Extensions), then run: select cron.schedule('${name}', '${schedule}', 'select public.${fn}()');  -- the statement in ${migration}`,
});

export const REQUIRED_JOBS: RequiredJob[] = [
  daily("novera-raw-evidence-expiry", "17 3 * * *", "expire_raw_evidence", "0037", "raw agent replies are emptied after the workspace's retention period"),
  daily("novera-inbound-probe-expiry", "27 3 * * *", "expire_inbound_and_probes", "0038", "support conversations and probe replies are erased after 90 days"),
  daily("novera-stalled-runs", "37 3 * * *", "abort_stalled_runs", "0040", "a run idle for 24 hours is stopped, never sealed"),
  {
    name: "novera-schedule-tick", schedule: "* * * * *", command: "net.http_post", maxAgeMinutes: 10,
    why: "scheduled runs start and advance, and failed webhook deliveries are retried",
    fix: "Enable pg_cron and pg_net (Supabase dashboard → Database → Extensions), then: npm run schedules:clock -- install",
  },
  daily("novera-cron-history", "47 3 * * *", "prune_cron_history", "0064", "pg_cron's own run history is kept 30 days, so it cannot grow without bound"),
];

export type JobState = "ok" | "missing" | "inactive" | "wrong_schedule" | "wrong_command" | "never_run" | "last_failed" | "stale";

export interface JobCheck { job: RequiredJob; state: JobState; detail: string }

/** Structural problems: the job is not there as the migrations or the clock installer define it. */
export const STRUCTURAL: JobState[] = ["missing", "inactive", "wrong_schedule", "wrong_command"];

/**
 * Pure: what each required job's state is, from `cron.job` rows and the latest
 * `cron.job_run_details` row per job. `allowNew` accepts a job that has never run yet — a
 * database migrated a minute ago has jobs whose first run is still to come.
 */
export function checkJobs(
  jobs: Array<{ jobname: string; schedule: string; active: boolean; command: string }>,
  lastRuns: Array<{ jobname: string; status: string; start_time: Date; last_success: Date | null }>,
  now: Date,
  options: { allowNew?: boolean } = {},
): JobCheck[] {
  return REQUIRED_JOBS.map((job) => {
    const row = jobs.find((j) => j.jobname === job.name);
    if (!row) return { job, state: "missing" as const, detail: "not scheduled" };
    if (!row.active) return { job, state: "inactive" as const, detail: "scheduled but switched off" };
    if (row.schedule !== job.schedule) return { job, state: "wrong_schedule" as const, detail: `runs at '${row.schedule}', expected '${job.schedule}'` };
    if (!row.command.includes(job.command)) return { job, state: "wrong_command" as const, detail: `its command does not call ${job.command}` };
    const last = lastRuns.find((r) => r.jobname === job.name);
    if (!last) {
      return options.allowNew
        ? { job, state: "ok" as const, detail: "scheduled; it has not run yet" }
        : { job, state: "never_run" as const, detail: "scheduled, but no run is recorded" };
    }
    if (last.status !== "succeeded") return { job, state: "last_failed" as const, detail: `last run ${last.start_time.toISOString()} ${last.status}` };
    const age = (now.getTime() - (last.last_success ?? last.start_time).getTime()) / 60_000;
    if (age > job.maxAgeMinutes) return { job, state: "stale" as const, detail: `last succeeded ${Math.round(age)} min ago (expected within ${job.maxAgeMinutes})` };
    return { job, state: "ok" as const, detail: `last succeeded ${(last.last_success ?? last.start_time).toISOString()}` };
  });
}

/** Reads what checkJobs needs. Read-only; the caller decides the transaction. */
export async function readJobs(client: { query: (sql: string) => Promise<{ rows: unknown[] }> }) {
  const { rows: ext } = await client.query("select 1 from pg_extension where extname = 'pg_cron'");
  if (!ext.length) return null;
  const { rows: jobs } = await client.query("select jobname, schedule, active, command from cron.job");
  // One lookup per job. The join this replaced computed a subquery for every history row and
  // timed out in production once the per-minute clock had written 16,401 of them (2026-10-10).
  const { rows: lastRuns } = await client.query(`
    select j.jobname, d.status, d.start_time, s.last_success
      from cron.job j
      join lateral (select status, start_time from cron.job_run_details
                     where jobid = j.jobid order by start_time desc limit 1) d on true
      left join lateral (select max(start_time) last_success from cron.job_run_details
                          where jobid = j.jobid and status = 'succeeded') s on true
     order by j.jobname`);
  return {
    jobs: jobs as Array<{ jobname: string; schedule: string; active: boolean; command: string }>,
    lastRuns: lastRuns as Array<{ jobname: string; status: string; start_time: Date; last_success: Date | null }>,
  };
}

/** A database on this machine (the local Supabase stack), where pg_cron is usually absent by design. */
export function isLocalDatabase(connectionString: string): boolean {
  const host = new URL(connectionString).hostname;
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
