/**
 * Loads the built-in conformity suites into the database.
 *
 * Built-in suites have workspace_id = null and are readable by any signed-in user.
 * Re-running is safe: a suite version is identified by (key, version), and an
 * existing version is left alone rather than overwritten — a run already points at
 * it, and silently changing the cases under a stored run would falsify its evidence.
 * A changed suite gets a new version number.
 *
 * Run: npm run seed:suites
 */
import { createClient } from "@supabase/supabase-js";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const dir = path.join(process.cwd(), "data", "suites");

/**
 * Not every JSON file in data/suites is a suite — eu-support-v1.labels.json holds
 * calibration ground truth. Identify a suite by its shape rather than its extension,
 * and say why anything else was skipped instead of failing on it.
 */
function isSuite(value: unknown): value is { key: string; version: number; name: string; cases: unknown[] } {
  const v = value as Record<string, unknown> | null;
  return (
    !!v &&
    typeof v.key === "string" &&
    typeof v.version === "number" &&
    typeof v.name === "string" &&
    Array.isArray(v.cases)
  );
}

for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json"))) {
  const parsed = JSON.parse(await readFile(path.join(dir, file), "utf8"));

  if (!isSuite(parsed)) {
    console.log(`  skipped    ${file} (not a suite: needs key, version, name and cases)`);
    continue;
  }
  const suite = parsed;

  const { data: existing } = await db
    .from("suites")
    .select("id")
    .is("workspace_id", null)
    .eq("key", suite.key)
    .eq("version", suite.version)
    .maybeSingle();

  if (existing) {
    console.log(`  unchanged  ${suite.key} v${suite.version} (already present; bump the version to change it)`);
    continue;
  }

  const { error } = await db.from("suites").insert({
    workspace_id: null,
    key: suite.key,
    version: suite.version,
    name: suite.name,
    cases: suite.cases,
  });

  if (error) {
    console.error(`  FAILED     ${suite.key} v${suite.version} — ${error.message}`);
    process.exit(1);
  }
  console.log(`  seeded     ${suite.key} v${suite.version} (${suite.cases.length} cases)`);
}

console.log("Done.\n");
