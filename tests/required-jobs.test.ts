import { test } from "node:test";
import assert from "node:assert/strict";
import { checkJobs, REQUIRED_JOBS } from "../scripts/required-jobs.mts";

const now = new Date("2026-10-01T10:00:00Z");
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const healthyJobs = () => REQUIRED_JOBS.map((j) => ({
  jobname: j.name, schedule: j.schedule, active: true,
  command: j.name === "novera-schedule-tick" ? "do $$ begin perform net.http_post(url := 'https://x/api/cron/tick'); end $$" : `select public.${j.command}`,
}));
const healthyRuns = () => REQUIRED_JOBS.map((j) => ({ jobname: j.name, status: "succeeded", start_time: ago(1), last_success: ago(1) }));
const stateOf = (checks: ReturnType<typeof checkJobs>, name: string) => checks.find((c) => c.job.name === name)!.state;

test("four jobs are required: three daily ones from the migrations and the clock", () => {
  assert.deepEqual(REQUIRED_JOBS.map((j) => j.name), ["novera-raw-evidence-expiry", "novera-inbound-probe-expiry", "novera-stalled-runs", "novera-schedule-tick"]);
});

test("every job present, on schedule and recently successful is ok", () => {
  assert.ok(checkJobs(healthyJobs(), healthyRuns(), now).every((c) => c.state === "ok"));
});

test("a job that is absent, switched off, rescheduled or calling something else is a structural problem", () => {
  const jobs = healthyJobs().filter((j) => j.jobname !== "novera-stalled-runs");
  jobs[0] = { ...jobs[0], active: false };
  jobs[1] = { ...jobs[1], schedule: "0 4 * * *" };
  jobs[2] = { ...jobs[2], command: "select 1" };
  const checks = checkJobs(jobs, healthyRuns(), now);
  assert.equal(stateOf(checks, "novera-stalled-runs"), "missing");
  assert.equal(stateOf(checks, "novera-raw-evidence-expiry"), "inactive");
  assert.equal(stateOf(checks, "novera-inbound-probe-expiry"), "wrong_schedule");
  assert.equal(stateOf(checks, "novera-schedule-tick"), "wrong_command");
});

test("a job that has never run is a problem, unless the database was migrated a moment ago", () => {
  const runs = healthyRuns().filter((r) => r.jobname !== "novera-raw-evidence-expiry");
  assert.equal(stateOf(checkJobs(healthyJobs(), runs, now), "novera-raw-evidence-expiry"), "never_run");
  assert.equal(stateOf(checkJobs(healthyJobs(), runs, now, { allowNew: true }), "novera-raw-evidence-expiry"), "ok");
});

test("a job whose last run failed, or that last succeeded too long ago, is not running", () => {
  const runs = healthyRuns();
  runs[0] = { ...runs[0], status: "failed" };
  runs[1] = { ...runs[1], start_time: ago(27 * 60), last_success: ago(27 * 60) };
  runs[3] = { ...runs[3], start_time: ago(15), last_success: ago(15) };
  const checks = checkJobs(healthyJobs(), runs, now);
  assert.equal(stateOf(checks, "novera-raw-evidence-expiry"), "last_failed");
  assert.equal(stateOf(checks, "novera-inbound-probe-expiry"), "stale", "a daily job missed a day");
  assert.equal(stateOf(checks, "novera-schedule-tick"), "stale", "the clock has not ticked for 15 minutes");
  assert.equal(stateOf(checks, "novera-stalled-runs"), "ok");
});
