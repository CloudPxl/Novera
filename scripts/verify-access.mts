/**
 * Verifies the two things a shared report must never get wrong: who can read it,
 * and whether its evidence can be rewritten after the fact.
 *
 * Runs against the most recent stored report. Temporarily revokes and expires it,
 * then restores the original values.
 *
 * Needs the dev server running.
 * Run: npm run verify:access
 */
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const { data: report, error } = await db
  .from("reports")
  .select("token, expires_at, revoked_at, run_id")
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

if (error || !report) {
  console.error("No report found. Run npm run demo:run first.");
  process.exit(1);
}

const url = `${appUrl}/report/${report.token}`;
const body = async () => (await fetch(url)).text();
const has = (haystack: string, needle: string) => haystack.includes(needle);

let failures = 0;
function check(ok: boolean, label: string, detail = "") {
  console.log(`  ${ok ? " ok " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const FINDINGS = "Findings (";

console.log("\nAccess control");
check(has(await body(), FINDINGS), "a live link renders the report");

await db.from("reports").update({ revoked_at: new Date().toISOString() }).eq("token", report.token);
let page = await body();
check(has(page, "no longer shared") && !has(page, FINDINGS), "a revoked link refuses and shows nothing");

await db
  .from("reports")
  .update({ revoked_at: null, expires_at: new Date(Date.now() - 86_400_000).toISOString() })
  .eq("token", report.token);
page = await body();
check(has(page, "no longer available") && !has(page, FINDINGS), "an expired link refuses and shows nothing");

const unknown = await fetch(`${appUrl}/report/this-token-does-not-exist-000000000000`);
check(unknown.status === 404, "an unknown token is a 404", `got ${unknown.status}`);

await db
  .from("reports")
  .update({ revoked_at: report.revoked_at, expires_at: report.expires_at })
  .eq("token", report.token);
check(has(await body(), FINDINGS), "the report is restored");

console.log("\nEvidence immutability, attempted with the service role");
const { error: payloadErr } = await db.from("reports").update({ payload: { tampered: true } }).eq("token", report.token);
check(!!payloadErr, "a report payload cannot be rewritten", payloadErr?.message.slice(0, 64));

const { error: hashErr } = await db.from("reports").update({ content_hash: "0".repeat(64) }).eq("token", report.token);
check(!!hashErr, "a report hash cannot be rewritten");

const { error: caseErr } = await db.from("run_cases").update({ status: "pass" }).eq("run_id", report.run_id);
check(!!caseErr, "a recorded verdict cannot be flipped to pass", caseErr?.message.slice(0, 64));

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
