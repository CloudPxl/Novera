/**
 * Applies the SQL files in supabase/migrations in filename order, exactly once each.
 *
 * Applied migrations are recorded in novera_migrations with a checksum, so a file
 * that changes after it was applied is reported rather than silently re-run or
 * silently skipped. Each migration runs inside a transaction: it applies completely
 * or not at all.
 *
 * Needs SUPABASE_DB_URL in .env.local (Supabase dashboard -> Project Settings ->
 * Database -> Connection string -> URI, with your database password substituted).
 *
 * Run: npm run migrate
 *
 * A migration already applied by hand (pasted into the Supabase SQL editor) is
 * recorded without being re-run:
 *   npm run migrate -- --baseline 0001_init.sql
 */
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import pg from "pg";

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error(
    "\nSUPABASE_DB_URL is not set in .env.local.\n" +
      "Supabase dashboard -> Project Settings -> Database -> Connection string -> URI,\n" +
      "then replace [YOUR-PASSWORD] with your database password.\n",
  );
  process.exit(1);
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();

await client.query(`
  create table if not exists novera_migrations (
    name text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  );
`);

const dir = path.join(process.cwd(), "supabase", "migrations");
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

const { rows: applied } = await client.query<{ name: string; checksum: string }>(
  "select name, checksum from novera_migrations",
);
const seen = new Map(applied.map((r) => [r.name, r.checksum]));

const baseline = new Set(
  process.argv.reduce<string[]>((acc, arg, i) => (process.argv[i - 1] === "--baseline" ? [...acc, arg] : acc), []),
);

for (const name of baseline) {
  if (!files.includes(name)) {
    console.error(`  UNKNOWN    ${name} is not a file in supabase/migrations`);
    await client.end();
    process.exit(1);
  }
}

let count = 0;
let drift = 0;

for (const file of files) {
  const sql = await readFile(path.join(dir, file), "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex").slice(0, 16);
  const previous = seen.get(file);

  if (previous === checksum) {
    console.log(`  applied    ${file}`);
    continue;
  }
  if (!previous && baseline.has(file)) {
    // Applied outside this runner (the SQL editor). Record it so history is complete
    // without executing it a second time.
    await client.query("insert into novera_migrations (name, checksum) values ($1, $2)", [file, checksum]);
    console.log(`  baselined  ${file} (recorded as already applied, not re-run)`);
    continue;
  }
  if (previous) {
    // Editing an applied migration means the database and the repo disagree about
    // history. Say so loudly instead of guessing which one is right.
    console.error(`  CHANGED    ${file} — already applied with a different checksum. Write a new migration instead of editing this one.`);
    drift++;
    continue;
  }

  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into novera_migrations (name, checksum) values ($1, $2)", [file, checksum]);
    await client.query("commit");
    console.log(`  ran        ${file}`);
    count++;
  } catch (error) {
    await client.query("rollback");
    console.error(`  FAILED     ${file} — ${error instanceof Error ? error.message : String(error)}`);
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log(`\n${count} migration(s) applied${drift ? `, ${drift} changed after the fact` : ""}.\n`);
process.exit(drift > 0 ? 1 : 0);
