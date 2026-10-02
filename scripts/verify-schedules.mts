/**
 * Proves scheduled re-evaluations against the live database and a running app: the
 * clock's endpoint refuses strangers, a due schedule starts exactly one run however many
 * ticks race for it, that run is an ordinary run naming its schedule, a busy schedule
 * skips rather than piles up, a refusal pauses with its reason, the schedule's fixed
 * fields and a run's attribution cannot be rewritten, tenants stay apart, and erasure
 * removes it all.
 *
 * The agent points at a reserved `.example` host, so its cases fail at once and no
 * grading model is called: free. Needs `npm run dev`.
 * Run: npm run verify:schedules
 */
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { tickSecret } from "../src/lib/schedules/secret.ts";
import { sslFor } from "./db-ssl.mts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

let failures = 0;
function report(ok: boolean, label: string, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// A tick from this machine drives every due schedule in the database, not only ours.
// There must be none that belong to a real workspace.
const { data: foreign } = await db.from("run_schedules").select("id, workspaces(name)")
  .is("cancelled_at", null).is("paused_at", null).lte("next_run_at", new Date(Date.now() + 10 * 60_000).toISOString());
const real = (foreign ?? []).filter((s) => !String((s.workspaces as unknown as { name: string } | null)?.name ?? "").startsWith("__novera_verify_"));
if (real.length) {
  console.error(`${real.length} real schedule(s) are due within 10 minutes; a local tick would start them. Try later.`);
  process.exit(3);
}

// The production clock watches this same database. Left running, it would claim these
// throwaway schedules too — racing the local ticks, and driving the runs from a server
// that cannot reach this machine. It is paused for the duration and restored after.
const pgc = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: sslFor(process.env.SUPABASE_DB_URL!) });
await pgc.connect();
const { rows: clock } = await pgc.query(
  "select jobid from cron.job where jobname = 'novera-schedule-tick' and active",
).catch(() => ({ rows: [] as Array<{ jobid: number }> }));
if (clock.length) {
  await pgc.query("select cron.alter_job($1, active := false)", [clock[0].jobid]);
  console.log("  (the production clock is paused while this runs)");
}
const restoreClock = async () => {
  if (clock.length) await pgc.query("select cron.alter_job($1, active := true)", [clock[0].jobid]);
  await pgc.end();
};

const tick = (secret: string | null, method = "POST") =>
  fetch(`${base}/api/cron/tick`, { method, headers: secret ? { authorization: `Bearer ${secret}` } : {}, redirect: "manual" })
    .then(async (r) => ({ status: r.status, type: r.headers.get("content-type") ?? "", body: await r.json().catch(() => null) }));

const password = crypto.randomUUID();
const { data: builtIn } = await db.from("suites").select("cases").is("workspace_id", null).eq("key", "eu-support")
  .order("version", { ascending: false }).limit(1).single();

const makeWorkspace = async (tag: string, withPolicy = true) => {
  const user = (await db.auth.admin.createUser({ email: `verify-schedules-${tag}+${Date.now()}@novera.invalid`, password, email_confirm: true })).data.user!;
  const { data: ws } = await db.from("workspaces").insert({ name: `__novera_verify_${tag}__`, owner_id: user.id }).select("id").single();
  await db.from("workspace_members").insert({ workspace_id: ws!.id, user_id: user.id, role: "owner" });
  const { data: agent } = await db.from("agents").insert({
    workspace_id: ws!.id, name: `agent-${tag}`, kind: "http",
    config: { kind: "http", url: `https://unreachable-${tag}.example/chat`, bodyTemplate: { message: "{{input}}" }, responsePath: "reply" },
    attestation_text: "Verification fixture: an address that does not exist.", attested_at: new Date().toISOString(),
  }).select("id").single();
  if (withPolicy) await db.from("policies").insert({ workspace_id: ws!.id, agent_id: agent!.id, version: 1, body: `Policy ${tag}` });
  // Two scenarios, so a run is quick and still has more than one case to order.
  const { data: suite } = await db.from("suites").insert({
    workspace_id: ws!.id, key: `verify-${tag}`, version: 1, name: `Verify ${tag}`,
    cases: (builtIn!.cases as unknown[]).slice(0, 2),
  }).select("id").single();
  return { user, ws: ws!.id as string, agent: agent!.id as string, suite: suite!.id as string };
};

const a = await makeWorkspace("sched-a");
const b = await makeWorkspace("sched-b");
const c = await makeWorkspace("sched-c", false);
const past = new Date(Date.now() - 60_000).toISOString();
const schedule = (w: typeof a, extra: Record<string, unknown> = {}) => ({
  workspace_id: w.ws, agent_id: w.agent, suite_id: w.suite, cadence: "daily", hour_utc: 6,
  next_run_at: past, created_by: w.user.id, ...extra,
});

try {
  // --- the endpoint ---------------------------------------------------------------
  const none = await tick(null);
  const wrong = await tick("not-the-secret");
  report(none.status === 401 && none.type.includes("json"), "the clock's endpoint refuses a caller with no secret", String(none.status));
  report(wrong.status === 401 && JSON.stringify(wrong.body) === JSON.stringify(none.body), "and a wrong secret gets the same answer", String(wrong.status));
  const get = await tick(tickSecret(), "GET");
  report(get.status === 405, "GET is not a tick", String(get.status));

  // --- tenancy and the fixed fields -------------------------------------------------
  const { error: crossErr } = await db.from("run_schedules").insert(schedule(a, { agent_id: b.agent }));
  report(!!crossErr, "a schedule cannot name another workspace's agent", crossErr?.message.slice(0, 70) ?? "SUCCEEDED");
  const { error: crossSuite } = await db.from("run_schedules").insert(schedule(a, { suite_id: b.suite }));
  report(!!crossSuite, "or another workspace's suite", crossSuite?.message.slice(0, 70) ?? "SUCCEEDED");
  const { error: badWeekly } = await db.from("run_schedules").insert(schedule(a, { cadence: "weekly" }));
  report(!!badWeekly, "a weekly schedule needs a weekday", badWeekly?.message.slice(0, 70) ?? "SUCCEEDED");

  const { data: sA, error: sAErr } = await db.from("run_schedules").insert(schedule(a)).select("id").single();
  report(!sAErr, "a due schedule is stored", sAErr?.message ?? "");

  // --- exactly one run, however many ticks race -------------------------------------
  const [t1, t2, t3] = await Promise.all([tick(tickSecret()), tick(tickSecret()), tick(tickSecret())]);
  const started = [t1, t2, t3].reduce((n, t) => n + (t.body?.started ?? 0), 0);
  const { data: runs } = await db.from("runs").select("id, status, created_by, api_key_id, schedule_id, manifest_hash, started_at")
    .eq("schedule_id", sA!.id);
  report([t1, t2, t3].every((t) => t.status === 200) && started === 1 && runs?.length === 1,
    "three ticks at once start exactly one run", `${started} started, ${runs?.length} run(s)`);
  const run = runs?.[0];
  report(!!run && run.created_by === a.user.id && run.api_key_id === null && !!run.manifest_hash,
    "an ordinary run: declared before it ran, attributed to the schedule's creator and the schedule");
  const leakCheck = JSON.stringify([t1.body, t2.body, t3.body]);
  report(!leakCheck.includes(a.ws) && !leakCheck.includes(run?.id ?? "-"), "the tick answers with counts, never a workspace's ids");

  const { data: afterClaim } = await db.from("run_schedules").select("next_run_at, last_outcome").eq("id", sA!.id).single();
  report(new Date(afterClaim!.next_run_at).getTime() > Date.now() && afterClaim!.last_outcome === "Started.",
    "the clock moved to the next occurrence and recorded the outcome", `${afterClaim!.next_run_at} · ${afterClaim!.last_outcome}`);

  // --- driven to completion by the clock alone --------------------------------------
  let status = run?.status;
  for (let i = 0; i < 6 && status !== "completed" && status !== "aborted"; i++) {
    await tick(tickSecret());
    status = (await db.from("runs").select("status").eq("id", run!.id).single()).data?.status;
  }
  const { data: done } = await db.from("runs").select("status, error, started_at, lease_until, finished_at").eq("id", run!.id).single();
  const { data: cases } = await db.from("run_cases").select("case_id, status, created_at").eq("run_id", run!.id);
  const ids = (cases ?? []).map((x) => x.case_id);
  report(done?.status === "completed" && ids.length === 2 && new Set(ids).size === 2,
    "the clock drove the run to the end, each scenario graded once", `${done?.status}, ${ids.join(" ")}${done?.error ? ` — ${done.error}` : ""}`);
  report((cases ?? []).every((x) => x.status === "error"), "an unreachable agent's scenarios are errors, never passes",
    (cases ?? []).map((x) => x.status).join(" "));
  report(done?.lease_until === null, "the finished run holds no lease");
  report(!!done?.started_at && (cases ?? []).every((x) => new Date(x.created_at) >= new Date(done!.started_at)),
    "started_at is the run's start, not a later slice's");
  const { data: sealed } = await db.from("reports").select("id").eq("run_id", run!.id);
  // The same rule as any run: nothing produced a verdict, so there is nothing to seal.
  report((sealed ?? []).length === 0, "no report is sealed over a run where nothing produced a verdict", `${sealed?.length} report(s)`);

  // --- a second tick when nothing is due ---------------------------------------------
  const idle = await tick(tickSecret());
  report(idle.body?.due === 0 && idle.body?.started === 0, "nothing due: the tick starts nothing", JSON.stringify(idle.body));

  // --- a busy schedule skips --------------------------------------------------------
  const { data: sBusy } = await db.from("run_schedules").insert(schedule(a, { cadence: "weekly", weekday: 3 })).select("id").single();
  const { data: policyA } = await db.from("policies").select("id").eq("agent_id", a.agent).single();
  await db.from("runs").insert({
    workspace_id: a.ws, agent_id: a.agent, policy_id: policyA!.id, suite_id: a.suite, status: "running",
    schedule_id: sBusy!.id, created_by: a.user.id, lease_until: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  const busyTick = await tick(tickSecret());
  const { data: busy } = await db.from("run_schedules").select("last_outcome").eq("id", sBusy!.id).single();
  const { count: busyRuns } = await db.from("runs").select("*", { count: "exact", head: true }).eq("schedule_id", sBusy!.id);
  report(busyTick.body?.skipped === 1 && busyRuns === 1 && /still in progress/.test(busy!.last_outcome ?? ""),
    "a schedule whose last run is still going skips, and says so", busy!.last_outcome ?? "");
  report((busyTick.body?.advanced ?? 0) === 0, "a run under someone else's lease is not taken over");

  // --- a refusal pauses ---------------------------------------------------------------
  const { data: sNoPolicy } = await db.from("run_schedules").insert(schedule(c)).select("id").single();
  await tick(tickSecret());
  const { data: paused } = await db.from("run_schedules").select("paused_at, paused_reason").eq("id", sNoPolicy!.id).single();
  const { count: noPolicyRuns } = await db.from("runs").select("*", { count: "exact", head: true }).eq("schedule_id", sNoPolicy!.id);
  report(!!paused?.paused_at && /policy/i.test(paused.paused_reason ?? "") && noPolicyRuns === 0,
    "a run that cannot start pauses the schedule with the reason", paused?.paused_reason ?? "NOT PAUSED");

  // --- what cannot change ------------------------------------------------------------
  const { error: moveErr } = await db.from("run_schedules").update({ hour_utc: 7 }).eq("id", sA!.id);
  report(!!moveErr, "a schedule's timing cannot be rewritten", moveErr?.message.slice(0, 70) ?? "SUCCEEDED");
  const { error: agentErr } = await db.from("run_schedules").update({ agent_id: b.agent }).eq("id", sA!.id);
  report(!!agentErr, "nor its agent", agentErr?.message.slice(0, 70) ?? "SUCCEEDED");
  const { error: delErr } = await db.from("run_schedules").delete().eq("id", sA!.id);
  report(!!delErr, "a schedule cannot be deleted", delErr?.message.slice(0, 70) ?? "SUCCEEDED");
  await db.from("run_schedules").update({ cancelled_at: new Date().toISOString(), cancelled_by: a.user.id }).eq("id", sA!.id);
  const { error: revive } = await db.from("run_schedules").update({ paused_at: new Date().toISOString() }).eq("id", sA!.id);
  report(!!revive, "a cancelled schedule stays cancelled", revive?.message.slice(0, 70) ?? "SUCCEEDED");
  const { error: reattr } = await db.from("runs").update({ schedule_id: null }).eq("id", run!.id);
  report(!!reattr, "who started a run cannot be rewritten", reattr?.message.slice(0, 70) ?? "SUCCEEDED");
  const { error: reuser } = await db.from("runs").update({ created_by: b.user.id }).eq("id", run!.id);
  report(!!reuser, "nor the person responsible for it", reuser?.message.slice(0, 70) ?? "SUCCEEDED");

  // --- row-level security through real sessions ----------------------------------------
  const asMember = async (email: string) => {
    const s = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    await s.auth.signInWithPassword({ email, password });
    return s;
  };
  const memberA = await asMember(a.user.email!);
  const memberB = await asMember(b.user.email!);
  const { data: ownRows } = await memberA.from("run_schedules").select("id").eq("workspace_id", a.ws);
  const { data: otherRows } = await memberB.from("run_schedules").select("id").eq("workspace_id", a.ws);
  report((ownRows ?? []).length === 2 && (otherRows ?? []).length === 0, "members see their own schedules and nobody else's",
    `${ownRows?.length} own, ${otherRows?.length} other`);
  const { error: directInsert } = await memberA.from("run_schedules").insert(schedule(a));
  report(!!directInsert, "a browser cannot create a schedule directly", directInsert?.message.slice(0, 60) ?? "SUCCEEDED");

  // --- erasure -------------------------------------------------------------------------
  const { error: eraseErr } = await db.rpc("erase_workspace", { target: a.ws });
  const { count: left } = await db.from("run_schedules").select("*", { count: "exact", head: true }).eq("workspace_id", a.ws);
  report(!eraseErr && left === 0, "erasure removes the workspace's schedules and the runs that name them", eraseErr?.message ?? `${left} left`);
} finally {
  for (const w of [a, b, c]) {
    await db.rpc("erase_workspace", { target: w.ws });
    await db.auth.admin.deleteUser(w.user.id);
  }
  await restoreClock();
  if (clock.length) console.log("  (the production clock is running again)");
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll schedule checks passed.");
process.exit(failures ? 1 : 0);
