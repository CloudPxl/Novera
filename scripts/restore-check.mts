/**
 * After a restore: is the restored database the database that was backed up?
 * Read-only on both sides (the two edit attempts run inside transactions that are rolled
 * back). docs/BACKUP-RESTORE-RUNBOOK.md says when to run it.
 *
 *   SOURCE_DB_URL=postgresql://…/postgres RESTORED_DB_URL=postgresql://…/drill_restore \
 *     node --no-warnings scripts/restore-check.mts
 *
 * Without SOURCE_DB_URL it checks the restored database alone (RLS, append-only, report
 * hashes) — the case after a real disaster, when there is no source left to compare with.
 * A non-local address is refused unless --allow-remote is given, so a drill cannot be
 * pointed at production by a copied command line.
 *
 * Checks: row counts of every table in public, auth, storage and vault; RLS on every public
 * table; policies, triggers, functions, grants and vault secrets counted; evidence still
 * refuses an edit; every sealed report's SHA-256 recomputes from its stored payload; the
 * migration ledger matches.
 *
 * Exit: 0 every check passed; 1 a check failed; 3 configuration.
 */
import pg from "pg";
import { contentHash, type Json } from "../src/lib/report/hash.ts";
import { sslFor } from "./db-ssl.mts";

const restoredUrl = process.env.RESTORED_DB_URL;
const sourceUrl = process.env.SOURCE_DB_URL;
if (!restoredUrl) {
  console.error("Set RESTORED_DB_URL (and SOURCE_DB_URL to compare with the original).");
  process.exit(3);
}
const isLocal = (u: string) => ["127.0.0.1", "localhost", "::1"].includes(new URL(u).hostname);
if (!process.argv.includes("--allow-remote") && [restoredUrl, sourceUrl].some((u) => u && !isLocal(u))) {
  console.error("A database that is not on this machine was named. Re-run with --allow-remote if that is intended.");
  process.exit(3);
}

const open = async (url: string) => { const c = new pg.Client({ connectionString: url, ssl: sslFor(url) }); await c.connect(); return c; };
const dst = await open(restoredUrl);
const src = sourceUrl ? await open(sourceUrl) : null;

let problems = 0;
const say = (ok: boolean, line: string) => { console.log(`${ok ? "  ok  " : " FAIL "} ${line}`); if (!ok) problems++; };
const one = async (c: pg.Client, sql: string) => (await c.query(sql)).rows[0];

// Row counts
const { rows: tables } = await dst.query(`select schemaname, tablename from pg_tables where schemaname in ('public','auth','storage','vault') order by 1,2`);
let differ = 0; let total = 0;
for (const t of tables) {
  const q = `select count(*)::int n from "${t.schemaname}"."${t.tablename}"`;
  const b = (await one(dst, q)).n as number;
  total += b;
  if (src) {
    let a: number | string;
    try { a = (await one(src, q)).n; } catch { a = "missing"; }
    if (a !== b) { differ++; console.log(`        ${t.schemaname}.${t.tablename}: source ${a}, restored ${b}`); }
  }
}
say(differ === 0, `row counts: ${tables.length} tables, ${total} rows${src ? `, ${differ} differ from the source` : ""}`);

// RLS
const rlsSql = `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`;
const rls = (await dst.query(rlsSql)).rows;
const off = rls.filter((r) => !r.relrowsecurity).map((r) => r.relname);
say(off.length === 0, `RLS enabled on ${rls.length - off.length}/${rls.length} public tables${off.length ? ` (off: ${off.join(", ")})` : ""}`);

// Structure counts
for (const [label, sql] of [
  ["RLS policies", `select count(*)::int n from pg_policies where schemaname = 'public'`],
  ["triggers on public tables", `select count(*)::int n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal`],
  ["functions in public", `select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`],
  ["grants to anon/authenticated/service_role", `select count(*)::int n from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated','service_role')`],
  ["vault secrets", `select count(*)::int n from vault.secrets`],
] as const) {
  const b = (await one(dst, sql)).n;
  if (src) { const a = (await one(src, sql)).n; say(a === b, `${label}: source ${a}, restored ${b}`); }
  else say(true, `${label}: ${b}`);
}

// Evidence still refuses edits
for (const [label, sql] of [
  ["a sealed report's hash", "update reports set content_hash = repeat('0', 64)"],
  ["deleting run cases", "delete from run_cases"],
] as const) {
  await dst.query("begin");
  try {
    const r = await dst.query(sql);
    say(r.rowCount === 0, `${label}: accepted on ${r.rowCount} rows — append-only triggers missing`);
  } catch (e) {
    say(true, `${label} refused ("${(e as Error).message.slice(0, 60)}")`);
  }
  await dst.query("rollback");
}

// Report hashes
const { rows: reports } = await dst.query("select id, payload, content_hash from reports order by created_at");
const bad = reports.filter((r) => contentHash(r.payload as Json) !== r.content_hash);
say(bad.length === 0, `${reports.length - bad.length}/${reports.length} sealed report hashes recompute from the stored payload${bad.length ? ` (mismatch: ${bad.map((r) => r.id).join(", ")})` : ""}`);

// Ledger
const ledgerSql = "select coalesce(string_agg(name || ':' || checksum, ',' order by name), '') s, count(*)::int n from novera_migrations";
const lb = await one(dst, ledgerSql);
if (src) { const la = await one(src, ledgerSql); say(la.s === lb.s, `migration ledger: ${lb.n} entries${la.s === lb.s ? ", identical to the source" : ", differs from the source"}`); }
else say(lb.n > 0, `migration ledger: ${lb.n} entries (compare with \`npm run migrate -- --check\`)`);

await dst.end();
await src?.end();
console.log(problems ? `\n${problems} problem(s).` : "\nEvery restore check passed.");
process.exit(problems ? 1 : 0);
