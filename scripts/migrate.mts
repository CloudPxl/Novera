/**
 * Applies the SQL files in supabase/migrations in filename order, exactly once each.
 *
 * Applied migrations are recorded in the ledger, novera_migrations, with a checksum, so a
 * file that changes after it was applied is reported rather than silently re-run or
 * silently skipped. Each migration runs inside a transaction: it applies completely or
 * not at all.
 *
 * The ledger decides what runs, so only this runner may touch it. It lives in `public`,
 * where Supabase's default privileges grant every new table to the API roles, so it is
 * created with row-level security on and every client grant revoked, in the same
 * transaction (0045). A ledger that a client role can reach is refused rather than
 * trusted: anyone with the public anon key could have added the row that makes a
 * migration skip (audit 2026-09-30, C1).
 *
 * Needs SUPABASE_DB_URL in .env.local (Supabase dashboard -> Project Settings ->
 * Database -> Connection string -> URI, with your database password substituted).
 *
 *   npm run migrate                      apply what is not yet applied
 *   npm run migrate -- --check           read-only: the ledger's exposure and drift; changes nothing
 *   npm run migrate -- --harden-ledger   close client access to an existing ledger, then apply
 *   npm run migrate -- --baseline 0001_init.sql
 *       record a migration already applied by hand (the SQL editor) without re-running it
 *
 * Exit codes: 0 done; 1 a migration failed, or the ledger and the files disagree;
 * 2 refused because client roles can reach the ledger; 3 every migration is applied, but
 * a scheduled job Novera depends on is missing from this (non-local) database — see
 * `npm run verify:cron`.
 */
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { checkJobs, isLocalDatabase, readJobs, STRUCTURAL } from "./required-jobs.mts";
import { sslFor } from "./db-ssl.mts";

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error(
    "\nSUPABASE_DB_URL is not set in .env.local.\n" +
      "Supabase dashboard -> Project Settings -> Database -> Connection string -> URI,\n" +
      "then replace [YOUR-PASSWORD] with your database password.\n",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const harden = args.includes("--harden-ledger");
if (checkOnly && harden) {
  console.error("--check changes nothing and --harden-ledger changes the ledger's access; choose one.");
  process.exit(1);
}

const LEDGER = "public.novera_migrations";
/** The roles PostgREST serves requests as. None of them may reach the ledger. */
const CLIENT_ROLES = ["anon", "authenticated", "service_role"];
const PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
/**
 * Serialises runners. Taken per transaction, not per session: Supabase's pooler (port
 * 6543) runs each transaction on whichever server connection is free, so a session lock
 * could outlive this process on someone else's connection.
 */
const LOCK = "select pg_advisory_xact_lock(hashtext('novera_migrations'))";

const client = new pg.Client({ connectionString, ssl: sslFor(connectionString) });
await client.connect();

async function finish(code: number): Promise<never> {
  await client.end();
  process.exit(code);
}

/** The client roles that exist here (a plain Postgres has none of Supabase's). */
const { rows: roleRows } = await client.query<{ rolname: string }>(
  "select rolname from pg_roles where rolname = any($1)", [CLIENT_ROLES],
);
const clientRoles = roleRows.map((r) => r.rolname);
const revokeSql = `revoke all on table ${LEDGER} from ${["public", ...clientRoles].join(", ")}`;

async function ledgerExists(): Promise<boolean> {
  const { rows } = await client.query<{ t: string | null }>("select to_regclass($1)::text t", [LEDGER]);
  return rows[0].t !== null;
}

/** Who can reach the ledger besides this runner: RLS off, or any client role holding any privilege. */
async function exposure(): Promise<string[]> {
  const { rows: [table] } = await client.query<{ rls: boolean }>(
    "select relrowsecurity rls from pg_class where oid = to_regclass($1)", [LEDGER],
  );
  const problems = table.rls ? [] : ["row-level security is off"];
  for (const role of clientRoles) {
    const { rows } = await client.query<{ p: string }>(
      "select p from unnest($2::text[]) p where has_table_privilege($1, $3, p)", [role, PRIVILEGES, LEDGER],
    );
    if (rows.length) problems.push(`${role} holds ${rows.map((r) => r.p).join(", ")}`);
  }
  return problems;
}

if (!checkOnly && !(await ledgerExists())) {
  // Created closed: the table, its row-level security and the revocation of the grants
  // Supabase adds to every new public table commit together, so there is no moment at
  // which a client role can reach it.
  await client.query("begin");
  await client.query(LOCK);
  await client.query(`
    create table if not exists ${LEDGER} (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);
  await client.query(`alter table ${LEDGER} enable row level security`);
  await client.query(revokeSql);
  await client.query("commit");
  console.log("  created    the ledger, reachable only by the migration runner");
}

if (checkOnly) {
  await client.query("begin transaction read only");
  if (!(await ledgerExists())) {
    console.log("\nNo ledger: this runner has applied nothing to this database.\n");
    await client.query("rollback");
    await finish(0);
  }
}

const exposed = await exposure();
if (exposed.length && harden) {
  await client.query("begin");
  await client.query(LOCK);
  await client.query(`alter table ${LEDGER} enable row level security`);
  await client.query(revokeSql);
  await client.query("commit");
  const still = await exposure();
  if (still.length) {
    console.error(`  FAILED     the ledger is still reachable after hardening: ${still.join("; ")}`);
    await finish(1);
  }
  console.log(`  hardened   the ledger: ${exposed.join("; ")} — closed`);
  console.log("             Rows written while it was open cannot be told apart by this runner;");
  console.log("             the comparison below is with the files in this checkout.");
} else if (exposed.length) {
  console.error(
    `\n  ${checkOnly ? "EXPOSED " : "REFUSED "}   client roles can reach the migration ledger: ${exposed.join("; ")}.\n` +
      "             Anyone holding the public anon key could have added a row that makes a\n" +
      "             migration look applied, so its contents are not trusted. " +
      (checkOnly ? "Close it with\n" : "Review it with\n             `npm run migrate -- --check`, then close it with\n") +
      "             `npm run migrate -- --harden-ledger`.\n",
  );
  if (!checkOnly) await finish(2);
} else if (checkOnly) {
  console.log("  protected  the ledger: row-level security on, no client role holds any privilege");
}

const dir = path.join(process.cwd(), "supabase", "migrations");
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
const checksumOf = async (file: string) =>
  createHash("sha256").update(await readFile(path.join(dir, file), "utf8")).digest("hex").slice(0, 16);

const { rows: applied } = await client.query<{ name: string; checksum: string }>(
  `select name, checksum from ${LEDGER}`,
);
const seen = new Map(applied.map((r) => [r.name, r.checksum]));

const baseline = new Set(args.reduce<string[]>((acc, arg, i) => (args[i - 1] === "--baseline" ? [...acc, arg] : acc), []));
for (const name of baseline) {
  if (!files.includes(name)) {
    console.error(`  UNKNOWN    ${name} is not a file in supabase/migrations`);
    await finish(1);
  }
}

// The ledger and the files must tell the same history before anything is added to it.
let drift = 0;
for (const name of [...seen.keys()].filter((n) => !files.includes(n)).sort()) {
  console.error(
    `  UNKNOWN    ${name} — recorded as applied, but there is no such file here. Either this\n` +
      "             checkout is behind the database (apply from the one that has the file), or the\n" +
      "             row was written by something other than this runner. Do not delete ledger rows to get past this.",
  );
  drift++;
}
const pending: Array<{ file: string; checksum: string }> = [];
for (const file of files) {
  const checksum = await checksumOf(file);
  const previous = seen.get(file);
  if (previous === checksum) {
    console.log(`  applied    ${file}`);
  } else if (previous) {
    console.error(
      `  CHANGED    ${file} — the ledger records checksum ${previous}; the file is ${checksum}. Either the\n` +
        "             file was edited after it was applied (restore it and write a new migration), or the\n" +
        `             ledger row was altered. Compare with \`git log -p -- supabase/migrations/${file}\`.`,
    );
    drift++;
  } else {
    pending.push({ file, checksum });
    if (checkOnly) console.log(`  pending    ${file}`);
  }
}

/**
 * Whether the jobs the migrations schedule — only when pg_cron is already installed — and
 * the clock exist. Migrations alone cannot guarantee it (audit R1). Structure only here;
 * `npm run verify:cron` also checks that they last succeeded.
 */
async function jobsMissing(): Promise<boolean> {
  const local = isLocalDatabase(connectionString!);
  const read = await readJobs(client);
  if (!read) {
    if (local) {
      console.log("  note       pg_cron is not installed on this local database: the scheduled jobs do not exist here.");
      return false;
    }
    console.error("  NOT READY  pg_cron is not installed, so the retention, stalled-run and clock jobs do not exist. Run `npm run verify:cron` for the fix.");
    return true;
  }
  const broken = checkJobs(read.jobs, read.lastRuns, new Date(), { allowNew: true }).filter((r) => STRUCTURAL.includes(r.state));
  for (const r of broken) console.error(`  NOT READY  ${r.job.name}: ${r.state} — ${r.detail}. ${r.job.fix}`);
  return broken.length > 0 && !local;
}

if (checkOnly) {
  const notReady = await jobsMissing();
  await client.query("rollback");
  const problems = (exposed.length ? 1 : 0) + drift + (notReady ? 1 : 0);
  console.log(`\n${pending.length} pending; ${drift} disagreement(s) between the ledger and the files${exposed.length ? "; the ledger is exposed" : ""}. Nothing was changed.\n`);
  await finish(problems ? 1 : 0);
}
if (drift) {
  console.error(`\nNothing applied: the ledger and the files disagree on ${drift} migration(s). Resolve that first.\n`);
  await finish(1);
}

let count = 0;
for (const { file, checksum } of pending) {
  const sql = await readFile(path.join(dir, file), "utf8");
  try {
    await client.query("begin");
    await client.query(LOCK);
    // Another runner may have applied it while this one waited for the lock.
    const { rows: already } = await client.query<{ checksum: string }>(`select checksum from ${LEDGER} where name = $1`, [file]);
    if (already.length) {
      await client.query("rollback");
      if (already[0].checksum !== checksum) {
        console.error(`  CHANGED    ${file} — applied by another run with checksum ${already[0].checksum}; the file is ${checksum}.`);
        await finish(1);
      }
      console.log(`  applied    ${file} (by another run, meanwhile)`);
      continue;
    }
    if (baseline.has(file)) {
      // Applied outside this runner (the SQL editor). Record it so history is complete
      // without executing it a second time.
      await client.query(`insert into ${LEDGER} (name, checksum) values ($1, $2)`, [file, checksum]);
      await client.query("commit");
      console.log(`  baselined  ${file} (recorded as already applied, not re-run)`);
      continue;
    }
    await client.query(sql);
    await client.query(`insert into ${LEDGER} (name, checksum) values ($1, $2)`, [file, checksum]);
    await client.query("commit");
    console.log(`  ran        ${file}`);
    count++;
  } catch (error) {
    await client.query("rollback");
    console.error(`  FAILED     ${file} — ${error instanceof Error ? error.message : String(error)}`);
    await finish(1);
  }
}

console.log(`\n${count} migration(s) applied.\n`);
if (await jobsMissing()) {
  console.error("\nEvery migration is applied, but this database is not ready: a required scheduled job is missing.\n");
  await finish(3);
}
await finish(0);
