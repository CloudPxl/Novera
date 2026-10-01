/**
 * Every free verifier, in order, against the configured database and app — the set that
 * needs no model, no email and no external network. One command for CI or a deployment,
 * reproducible from an empty database once it is migrated and seeded (audit G3).
 *
 *   npm run migrate && npm run seed:suites && npm run seed:docs   (once, on a new database)
 *   npm run dev                                                  (in another terminal)
 *   npm run verify:free
 *
 * It does not migrate or seed for you: against a deployed database those are deliberate
 * acts, and seeding the docs publishes them. It says which is missing instead.
 *
 * Exit: 0 every verifier passed; 1 one failed or could not start; 2 none failed but one
 * could not check everything here (pg_cron on a local stack) — not a pass.
 */
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const FREE = [
  "verify:db", "verify:tenancy", "verify:access", "verify:byok", "verify:throttle", "verify:imports",
  "verify:regressions", "verify:retention", "verify:api", "verify:mcp", "verify:webhooks",
  "verify:schedules", "verify:leases", "verify:slices",
  // A database deployed a minute ago has jobs whose first run is still to come.
  "verify:cron -- --allow-new",
];

const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const missing: string[] = [];
const app = await fetch(base, { signal: AbortSignal.timeout(10_000) }).then((r) => r.status, () => 0);
if (app === 0) missing.push(`the app at ${base} does not answer — start it with \`npm run dev\``);
const { count: suites, error: dbError } = await db.from("suites").select("id", { count: "exact", head: true }).is("workspace_id", null);
if (dbError) missing.push(`the database does not answer as expected (${dbError.message}) — run \`npm run migrate\``);
else if (!suites) missing.push("no built-in suite is seeded — run `npm run seed:suites`");
const { count: docs } = await db.from("doc_pages").select("slug", { count: "exact", head: true });
if (!dbError && !docs) missing.push("no documentation is seeded — run `npm run seed:docs`");
if (missing.length) {
  console.error(`\nNot run. ${missing.join("; ")}.\n`);
  process.exit(1);
}

const results: Array<{ name: string; code: number; seconds: number }> = [];
for (const name of FREE) {
  const started = Date.now();
  const code = await new Promise<number>((resolve) => {
    const child = spawn("npm", ["run", "--silent", ...name.split(" ")], { stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const keep = (b: Buffer) => { tail = (tail + b.toString()).slice(-4_000); };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("close", (c) => {
      if (c !== 0) console.log(tail.split("\n").filter((l) => /FAIL|Error|not installed|not checked/.test(l)).slice(-6).map((l) => `      ${l.trim()}`).join("\n"));
      resolve(c ?? 1);
    });
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  results.push({ name, code, seconds });
  console.log(`${code === 0 ? "  ok  " : code === 2 ? "  --  " : " FAIL "} ${name.padEnd(20)} exit ${code}, ${seconds} s${code === 2 ? " (not everything could be checked here)" : ""}`);
}

const failed = results.filter((r) => r.code !== 0 && r.code !== 2);
const partial = results.filter((r) => r.code === 2);
console.log(failed.length
  ? `\n${failed.length} verifier(s) failed: ${failed.map((r) => r.name).join(", ")}.\n`
  : partial.length
    ? `\nNone failed; ${partial.map((r) => r.name).join(", ")} could not check everything here. Not a pass on this database.\n`
    : "\nEvery free verifier passed.\n");
process.exit(failed.length ? 1 : partial.length ? 2 : 0);
