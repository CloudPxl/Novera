/**
 * Installs, inspects or removes the schedule clock: a pg_cron job that calls
 * /api/cron/tick through pg_net once a minute — but only when a schedule is due or a
 * scheduled run is still in progress, so an idle database makes no request at all.
 *
 *   npm run schedules:clock -- install [--url https://www.nover.space/api/cron/tick]
 *   npm run schedules:clock -- status
 *   npm run schedules:clock -- remove
 *
 * The bearer secret is derived from NOVERA_ENCRYPTION_KEY (src/lib/schedules/secret.ts)
 * and stored in Supabase Vault; the job reads it from there at call time, so it is in
 * neither the job's text nor this script's output. Needs pg_cron and pg_net enabled
 * (Supabase dashboard → Database → Extensions).
 */
import pg from "pg";
import { tickSecret } from "../src/lib/schedules/secret.ts";

const JOB = "novera-schedule-tick";
const SECRET_NAME = "novera_schedule_tick";
const DEFAULT_URL = "https://www.nover.space/api/cron/tick";

const [command = "status", ...rest] = process.argv.slice(2);
const urlFlag = rest.indexOf("--url");
const url = urlFlag >= 0 ? rest[urlFlag + 1] : DEFAULT_URL;

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  const { rows: ext } = await client.query<{ name: string; installed_version: string | null }>(
    "select name, installed_version from pg_available_extensions where name in ('pg_cron', 'pg_net', 'supabase_vault')",
  );
  const missing = ["pg_cron", "pg_net", "supabase_vault"].filter((n) => !ext.find((e) => e.name === n)?.installed_version);
  if (missing.length) {
    console.error(`Not enabled: ${missing.join(", ")}. Supabase dashboard → Database → Extensions.`);
    process.exit(3);
  }

  if (command === "install") {
    // The URL goes into the job's SQL text, so it is checked rather than escaped.
    if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/api\/cron\/tick$/.test(url ?? "")) {
      console.error(`Refusing URL ${JSON.stringify(url)}: expected https://<host>/api/cron/tick.`);
      process.exit(3);
    }

    const secret = tickSecret();
    const { rows: existing } = await client.query("select id from vault.secrets where name = $1", [SECRET_NAME]);
    if (existing.length) {
      await client.query("select vault.update_secret($1, $2)", [existing[0].id, secret]);
    } else {
      await client.query("select vault.create_secret($1, $2, $3)", [
        secret, SECRET_NAME, "Bearer secret the schedule clock presents to /api/cron/tick",
      ]);
    }

    const body = `
      select net.http_post(
        url := '${url}',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = '${SECRET_NAME}')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 58000
      )
      where exists (
        select 1 from public.run_schedules
        where next_run_at <= now() and paused_at is null and cancelled_at is null
      ) or exists (
        select 1 from public.runs where schedule_id is not null and status in ('queued', 'running')
      )`;
    await client.query("select cron.schedule($1, '* * * * *', $2)", [JOB, body]);
    console.log(`Installed ${JOB}: every minute, calling ${url} when a schedule is due or a scheduled run is in progress.`);
  } else if (command === "remove") {
    const { rows } = await client.query("select jobid from cron.job where jobname = $1", [JOB]);
    if (rows.length) await client.query("select cron.unschedule($1)", [JOB]);
    console.log(rows.length ? `Removed ${JOB}.` : `${JOB} was not installed.`);
  } else if (command === "status") {
    const { rows: job } = await client.query("select jobid, schedule, active from cron.job where jobname = $1", [JOB]);
    if (!job.length) {
      console.log(`${JOB} is not installed. Run: npm run schedules:clock -- install`);
    } else {
      console.log(`${JOB}: ${job[0].schedule}, ${job[0].active ? "active" : "inactive"}`);
      const { rows: runs } = await client.query(
        `select status, return_message, start_time from cron.job_run_details
         where jobid = $1 order by start_time desc limit 5`, [job[0].jobid]);
      for (const r of runs) console.log(`  job   ${r.start_time.toISOString()}  ${r.status}  ${String(r.return_message).slice(0, 80)}`);
      // pg_net keeps responses for a few hours; only the status and our counts, never headers.
      const { rows: calls } = await client.query(
        `select status_code, left(content, 160) as content, created, error_msg from net._http_response
         order by created desc limit 5`);
      for (const c of calls) console.log(`  call  ${c.created.toISOString()}  ${c.status_code ?? "-"}  ${c.error_msg ?? c.content ?? ""}`);
    }
    const { rows: counts } = await client.query(
      `select count(*) filter (where cancelled_at is null and paused_at is null) as active,
              count(*) filter (where cancelled_at is null and paused_at is not null) as paused,
              count(*) filter (where cancelled_at is null and next_run_at <= now() and paused_at is null) as due
       from run_schedules`);
    console.log(`Schedules: ${counts[0].active} active, ${counts[0].paused} paused, ${counts[0].due} due now.`);
  } else {
    console.error(`Unknown command ${JSON.stringify(command)}. Use install, status or remove.`);
    process.exit(3);
  }
} finally {
  await client.end();
}
