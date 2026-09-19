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

const { error: caseDelErr } = await db.from("run_cases").delete().eq("run_id", report.run_id);
check(!!caseDelErr, "a failing case cannot be deleted from a run", caseDelErr?.message.slice(0, 64));

const { error: reportDelErr } = await db.from("reports").delete().eq("token", report.token);
check(!!reportDelErr, "a report cannot be deleted, only revoked", reportDelErr?.message.slice(0, 64));

// Erasure exists so a customer can be forgotten; it must not become a way to quietly
// drop inconvenient evidence. Prove a whole workspace goes, and only as one act.
console.log("\nErasure (GDPR Article 17), on a throwaway workspace");
const { data: ownerData, error: ownerErr } = await db.auth.admin.createUser({
  email: `erasure-${Date.now()}@novera.invalid`, password: crypto.randomUUID(), email_confirm: true,
});
if (ownerErr || !ownerData.user) throw new Error(`Could not create the erasure test user: ${ownerErr?.message}`);
const owner = ownerData.user;
const { data: ws } = await db
  .from("workspaces").insert({ name: "erasure test", owner_id: owner.id }).select("id").single();
const { data: ag } = await db
  .from("agents").insert({ workspace_id: ws!.id, name: "a", kind: "http", config: {} }).select("id").single();
const { data: pol } = await db
  .from("policies").insert({ workspace_id: ws!.id, agent_id: ag!.id, version: 1, body: "p" }).select("id").single();
const { data: st } = await db
  .from("suites").select("id").is("workspace_id", null).eq("key", "eu-support").eq("version", 1).single();
const { data: rn } = await db
  .from("runs").insert({ workspace_id: ws!.id, agent_id: ag!.id, policy_id: pol!.id, suite_id: st!.id, status: "completed" })
  .select("id").single();
await db.from("run_cases").insert({
  workspace_id: ws!.id, run_id: rn!.id, case_id: "T01", category: "policy", obligation: "policy_accuracy",
  severity: "low", input: "i", expected: "e", assertions: [], status: "fail", judge_attempts: [],
});

const { error: pieceErr } = await db.from("policies").delete().eq("id", pol!.id);
check(!!pieceErr, "a single policy version still cannot be deleted on its own", pieceErr?.message.slice(0, 64));

const { data: erasure, error: eraseErr } = await db.rpc("erase_workspace", { target: ws!.id, requested_by: owner.id });
check(!eraseErr, "an authorised erasure removes the whole workspace", eraseErr?.message.slice(0, 80));
check(erasure?.cases_removed === 1 && erasure?.runs_removed === 1, "the erasure log records what was removed",
  `agents ${erasure?.agents_removed}, runs ${erasure?.runs_removed}, cases ${erasure?.cases_removed}`);

const { count: leftover } = await db.from("run_cases").select("*", { count: "exact", head: true }).eq("workspace_id", ws!.id);
check(leftover === 0, "no case evidence survives the erasure", `${leftover} row(s) left`);

const { error: afterErr } = await db.from("run_cases").delete().eq("run_id", report.run_id);
check(!!afterErr, "piecemeal deletion is refused again once the erasure is over", afterErr?.message.slice(0, 64));

await db.auth.admin.deleteUser(owner.id);

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
