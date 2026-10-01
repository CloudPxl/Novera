/**
 * Every scheduled job Novera depends on exists, is switched on, runs on its schedule and
 * last succeeded recently enough (scripts/required-jobs.mts). Read-only: one transaction,
 * opened read only and rolled back.
 *
 * Part of every deployment to a new or restored database, after `npm run migrate`:
 * migrations create the daily jobs only when pg_cron was already installed, and the clock
 * is installed separately, so nothing else would notice them missing.
 *
 *   npm run verify:cron                 against SUPABASE_DB_URL
 *   npm run verify:cron -- --allow-new  a job that has never run yet counts as present
 *
 * Exit: 0 every job is in place and healthy; 1 a job is missing, off, wrong or not running;
 * 2 pg_cron is not installed on a local database — not applicable here, not a pass.
 */
import pg from "pg";
import { checkJobs, isLocalDatabase, readJobs, REQUIRED_JOBS } from "./required-jobs.mts";
import { sslFor } from "./db-ssl.mts";

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error("SUPABASE_DB_URL is not set in .env.local.");
  process.exit(1);
}
const local = isLocalDatabase(connectionString);
const allowNew = process.argv.includes("--allow-new");
const client = new pg.Client({ connectionString, ssl: sslFor(connectionString) });
await client.connect();

let code = 0;
try {
  await client.query("begin transaction read only");
  const read = await readJobs(client);
  if (!read) {
    if (local) {
      console.log("\npg_cron is not installed on this local database, so none of the required jobs can exist here.");
      console.log("That is expected for a local stack. It is not a pass: run this against the deployed database.\n");
      code = 2;
    } else {
      console.error("\nMISSING  pg_cron is not installed. None of these jobs exist:");
      for (const job of REQUIRED_JOBS) console.error(`  - ${job.name}: ${job.why}`);
      console.error("\nSupabase dashboard → Database → Extensions → enable pg_cron and pg_net; then schedule each job:");
      for (const job of REQUIRED_JOBS) console.error(`  ${job.fix}`);
      console.error("");
      code = 1;
    }
  } else {
    console.log("");
    for (const r of checkJobs(read.jobs, read.lastRuns, new Date(), { allowNew })) {
      console.log(`${r.state === "ok" ? "  ok  " : " FAIL "} ${r.job.name.padEnd(28)} ${r.state === "ok" ? "" : `${r.state}: `}${r.detail}`);
      if (r.state !== "ok") {
        console.log(`        why it matters: ${r.job.why}`);
        console.log(`        fix: ${r.job.fix}`);
        code = 1;
      }
    }
    console.log(code === 0 ? "\nEvery required job is in place.\n" : "\nA required job is not in place.\n");
  }
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
process.exit(code);
