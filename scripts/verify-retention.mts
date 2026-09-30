/**
 * Proves the raw-evidence retention clock against the live database: raw replies past a
 * workspace's period are emptied and stamped, nothing else about the case changes, the
 * fingerprint taken at grading still matches the evidence as it was, recent evidence and
 * other workspaces are untouched, and nothing but the expiry function can do it.
 *
 * Free. Run: npm run verify:retention
 */
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const sql = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await sql.connect();

let failures = 0;
function report(ok: boolean, label: string, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const makeWorkspace = async (tag: string, retention: number) => {
  const user = (await db.auth.admin.createUser({ email: `verify-retention-${tag}+${Date.now()}@novera.invalid`, password: crypto.randomUUID(), email_confirm: true })).data.user!;
  const { data: ws } = await db.from("workspaces").insert({ name: `__novera_verify_${tag}__`, owner_id: user.id, raw_evidence_days: retention }).select("id").single();
  const { data: agent } = await db.from("agents").insert({ workspace_id: ws!.id, name: tag, kind: "http", config: { kind: "http", url: "https://x.example" } }).select("id").single();
  const { data: policy } = await db.from("policies").insert({ workspace_id: ws!.id, agent_id: agent!.id, version: 1, body: "p" }).select("id").single();
  const { data: suite } = await db.from("suites").select("id").is("workspace_id", null).limit(1).single();
  // Created running, completed after its cases, as the runner does: a completed run takes no new evidence (0043).
  const { data: run } = await db.from("runs").insert({ workspace_id: ws!.id, agent_id: agent!.id, policy_id: policy!.id, suite_id: suite!.id, status: "running" }).select("id").single();
  return { user, ws: ws!.id as string, run: run!.id as string, policy: policy!.id as string };
};
const caseRow = (w: { ws: string; run: string }, id: string, age: number, reply: string) => ({
  workspace_id: w.ws, run_id: w.run, case_id: id, category: "c", obligation: "data_minimisation", severity: "high",
  input: "Who owns this account?", expected: "x", assertions: ["a"], status: "fail", rationale: "Disclosed contact details.",
  response_text: reply, tool_activity: [{ name: "lookup", arguments: { q: "northwind" } }],
  transcript: [{ role: "customer", content: "Who owns it?" }, { role: "agent", content: reply }],
  created_at: days(age),
});

const a = await makeWorkspace("retention-a", 30);
const b = await makeWorkspace("retention-b", 365);

try {
  const reply = "It is Marta Lindqvist, marta.lindqvist@northwind.example.";
  const { data: inserted, error: insErr } = await db.from("run_cases").insert([
    caseRow(a, "OLD", 31, reply), caseRow(a, "NEW", 5, reply), caseRow(b, "OLD", 31, reply),
  ]).select("id, case_id, workspace_id, raw_sha256");
  await db.from("runs").update({ status: "completed" }).in("id", [a.run, b.run]);
  report(!insErr && (inserted ?? []).every((r) => /^[0-9a-f]{64}$/.test(r.raw_sha256 ?? "")),
    "every stored case gets a fingerprint of its raw evidence when it is written", insErr?.message ?? "");
  const oldA = inserted!.find((r) => r.case_id === "OLD" && r.workspace_id === a.ws)!;
  const { rows: [expected] } = await sql.query(
    "select raw_evidence_sha256($1, $2::jsonb, $3::jsonb) as h",
    [reply, JSON.stringify(caseRow(a, "OLD", 31, reply).transcript), JSON.stringify(caseRow(a, "OLD", 31, reply).tool_activity)],
  );
  report(oldA.raw_sha256 === expected.h, "and the fingerprint can be recomputed from the evidence by anyone who holds it");

  const { data: retest } = await db.from("case_retests").insert({
    workspace_id: a.ws, run_case_id: oldA.id, policy_id: a.policy, response_text: reply, status: "fail", created_at: days(40),
  }).select("id, raw_sha256").single();

  // Outside the function, the rule is the rule.
  const { error: direct } = await db.from("run_cases").update({ response_text: null }).eq("id", oldA.id);
  report(!!direct, "the service role cannot empty a reply directly", direct?.message.slice(0, 60) ?? "SUCCEEDED");
  let smuggled = "SUCCEEDED";
  try {
    await sql.query("begin");
    await sql.query("select set_config('novera.expiring_raw', 'on', true)");
    await sql.query("update run_cases set status = 'pass', response_text = null, transcript = null, tool_activity = null, raw_expired_at = now() where id = $1", [oldA.id]);
  } catch (e) {
    smuggled = (e as Error).message.slice(0, 60);
  } finally {
    await sql.query("rollback");
  }
  report(smuggled !== "SUCCEEDED", "even in expiry mode, an update that also changes the verdict is refused", smuggled);
  let reopened = "SUCCEEDED";
  try {
    await sql.query("begin");
    await sql.query("select set_config('novera.expiring_raw', 'on', true)");
    await sql.query("update policies set body = 'rewritten' where id = $1", [a.policy]);
  } catch (e) {
    reopened = (e as Error).message.slice(0, 60);
  } finally {
    await sql.query("rollback");
  }
  report(reopened !== "SUCCEEDED", "and expiry mode opens no other table", reopened);

  const { rows: [counts] } = await sql.query("select expire_raw_evidence() as c");
  report(counts.c.cases >= 1 && counts.c.retests >= 1, "the daily pass empties what is past its period", JSON.stringify(counts.c));

  const { data: after } = await db.from("run_cases")
    .select("case_id, workspace_id, response_text, transcript, tool_activity, raw_expired_at, raw_sha256, status, rationale, input")
    .in("workspace_id", [a.ws, b.ws]);
  const old = after!.find((r) => r.case_id === "OLD" && r.workspace_id === a.ws)!;
  const fresh = after!.find((r) => r.case_id === "NEW")!;
  const otherWs = after!.find((r) => r.workspace_id === b.ws)!;
  report(old.response_text === null && old.transcript === null && old.tool_activity === null && !!old.raw_expired_at,
    "a reply past 30 days is emptied, with the date it was");
  report(old.status === "fail" && old.rationale === "Disclosed contact details." && old.input === "Who owns this account?" && old.raw_sha256 === oldA.raw_sha256,
    "its verdict, reasons, scenario and fingerprint are kept");
  report(fresh.response_text === reply && fresh.raw_expired_at === null, "a reply inside the period is untouched");
  report(otherWs.response_text === reply, "a workspace keeping 365 days is untouched by another's 30");
  const { data: retestAfter } = await db.from("case_retests").select("response_text, raw_expired_at, raw_sha256").eq("id", retest!.id).single();
  report(retestAfter!.response_text === null && !!retestAfter!.raw_expired_at && retestAfter!.raw_sha256 === retest!.raw_sha256,
    "retests expire on the same clock");

  const { rows: [again] } = await sql.query("select expire_raw_evidence() as c");
  report(again.c.cases === 0 && again.c.retests === 0, "a second pass changes nothing it already changed", JSON.stringify(again.c));

  const { error: badDays } = await db.from("workspaces").update({ raw_evidence_days: 7 }).eq("id", a.ws);
  report(!!badDays, "a period outside the offered choices is refused", badDays?.message.slice(0, 60) ?? "SUCCEEDED");

  const { rows: job } = await sql.query("select schedule, active from cron.job where jobname = 'novera-raw-evidence-expiry'");
  report(job.length === 1 && job[0].active, "the daily pass is scheduled", job[0] ? `${job[0].schedule}` : "missing");

  // --- support messages and probe receipts: 90 days (0038) ---------------------------
  const tag = `verify-retention-${Date.now()}`;
  const { data: oldReq } = await db.from("inbound_requests").insert({ kind: "support", email: `${tag}-old@novera.invalid`, message: "old", created_at: days(100) }).select("id").single();
  await db.from("reply_drafts").insert({ request_id: oldReq!.id, body: "old draft", created_at: days(99) });
  const { data: liveReq } = await db.from("inbound_requests").insert({ kind: "support", email: `${tag}-live@novera.invalid`, message: "old but answered lately", created_at: days(100) }).select("id").single();
  await db.from("reply_drafts").insert({ request_id: liveReq!.id, body: "recent draft", created_at: days(10) });
  const { data: agentA } = await db.from("agents").select("id").eq("workspace_id", a.ws).single();
  const { data: probes } = await db.from("probes").insert([
    { workspace_id: a.ws, agent_id: agentA!.id, request: { message: "hi" }, status_code: 200, response_body: "old reply jan@example.com", response_shape: { paths: [] }, latency_ms: 120, created_at: days(95) },
    { workspace_id: a.ws, agent_id: agentA!.id, request: { message: "hi" }, status_code: 200, response_body: "recent reply", latency_ms: 90, created_at: days(3) },
  ]).select("id, created_at").order("created_at");

  const { error: probeDirect } = await db.from("probes").update({ response_body: null }).eq("id", probes![0].id);
  report(!!probeDirect, "a probe receipt cannot be emptied directly", probeDirect?.message.slice(0, 60) ?? "SUCCEEDED");

  const { rows: [inbound] } = await sql.query("select expire_inbound_and_probes() as c");
  report(inbound.c.requests >= 1 && inbound.c.probes >= 1, "the 90-day pass runs", JSON.stringify(inbound.c));
  const { data: gone } = await db.from("inbound_requests").select("id").eq("id", oldReq!.id);
  const { data: goneDrafts } = await db.from("reply_drafts").select("id").eq("request_id", oldReq!.id);
  report((gone ?? []).length === 0 && (goneDrafts ?? []).length === 0, "a conversation idle for 90 days is erased with its drafts");
  const { data: logRow } = await db.from("inbound_erasure_log").select("reason, drafts_removed").eq("request_id", oldReq!.id).single();
  report(logRow?.reason === "retention" && logRow.drafts_removed === 1, "and the erasure is logged as retention, not as a request", JSON.stringify(logRow));
  const { data: kept } = await db.from("inbound_requests").select("id").eq("id", liveReq!.id);
  report((kept ?? []).length === 1, "an old request answered within 90 days is kept");
  const { data: probesAfter } = await db.from("probes").select("id, response_body, response_shape, status_code, latency_ms, content_expired_at").in("id", probes!.map((x) => x.id)).order("created_at");
  report(probesAfter![0].response_body === null && probesAfter![0].response_shape === null && !!probesAfter![0].content_expired_at
    && probesAfter![0].status_code === 200 && probesAfter![0].latency_ms === 120,
    "a 95-day-old probe loses its reply and keeps when, the status and the latency");
  report(probesAfter![1].response_body === "recent reply" && !probesAfter![1].content_expired_at, "a recent probe is untouched");
  const { rows: job2 } = await sql.query("select schedule, active from cron.job where jobname = 'novera-inbound-probe-expiry'");
  report(job2.length === 1 && job2[0].active, "the 90-day pass is scheduled", job2[0]?.schedule ?? "missing");
  await sql.query("select erase_inbound_request($1)", [liveReq!.id]);

  const { error: eraseErr } = await db.rpc("erase_workspace", { target: a.ws });
  const { count } = await db.from("run_cases").select("*", { count: "exact", head: true }).eq("workspace_id", a.ws);
  report(!eraseErr && count === 0, "erasure still removes everything, expired or not", eraseErr?.message ?? `${count} left`);
} finally {
  for (const w of [a, b]) {
    await db.rpc("erase_workspace", { target: w.ws });
    await db.auth.admin.deleteUser(w.user.id);
  }
  await sql.end();
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll retention checks passed.");
process.exit(failures ? 1 : 0);
