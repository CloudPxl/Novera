/**
 * Proves a run against a slow agent stays inside the platform's 60 s function limit.
 *
 * Starts a real run through the public API against an agent that takes ten seconds per
 * reply (httpbin's /delay/10), drives it slice by slice with the execute endpoint, and
 * times every call. A slice must hand back well before 60 s, the run must finish, and
 * every scenario must be recorded — none lost to a killed function, none cut short by
 * Novera's own budget. Then the shared grading slots (0041): a third concurrent trial
 * run waits rather than being refused; and a run stopped mid-slice stays stopped.
 *
 * The agent's replies are deliberately unreadable (wrong response path), so no model is
 * called: this measures time, not grading. Needs `npm run dev` and network access.
 * Run: npm run verify:slices
 */
import { createClient } from "@supabase/supabase-js";
import { mintKey } from "../src/lib/api/keys.ts";

const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const CEILING_MS = 60_000;
const SAFE_MS = 57_000;
const CASES = 12;

let failures = 0;
function report(ok: boolean, label: string, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const user = (await db.auth.admin.createUser({ email: `verify-slices+${Date.now()}@novera.invalid`, password: crypto.randomUUID(), email_confirm: true })).data.user!;
const { data: ws } = await db.from("workspaces").insert({ name: "__novera_verify_slices__", owner_id: user.id }).select("id").single();
const made: Array<{ ws: string; user: string }> = [];

try {
  await db.from("workspace_members").insert({ workspace_id: ws!.id, user_id: user.id, role: "owner" });
  const { data: agent } = await db.from("agents").insert({
    workspace_id: ws!.id, name: "ten-second agent", kind: "http", is_production: false,
    config: { kind: "http", url: "https://httpbin.org/delay/10", bodyTemplate: { message: "{{input}}" }, responsePath: "reply" },
  }).select("id").single();
  await db.from("policies").insert({ workspace_id: ws!.id, agent_id: agent!.id, version: 1, body: "Answer from the documentation only." });
  const { data: builtIn } = await db.from("suites").select("cases").eq("key", "eu-support").eq("version", 4).is("workspace_id", null).single();
  const cases = (builtIn!.cases as Array<Record<string, unknown>>)
    .filter((c) => !c.earlier_turns && !c.persona && !c.context && !c.destructive && !c.fixture_only)
    .slice(0, CASES);
  const { data: suite } = await db.from("suites").insert({ workspace_id: ws!.id, key: "slices", version: 1, name: "slices", cases }).select("id").single();
  const minted = mintKey();
  await db.from("api_keys").insert({ workspace_id: ws!.id, name: "slices", prefix: minted.prefix, key_hash: minted.hash, scopes: ["read", "run"], created_by: user.id });
  const headers = { authorization: `Bearer ${minted.key}`, "content-type": "application/json" };

  const started = await fetch(`${base}/api/v1/runs`, { method: "POST", headers, body: JSON.stringify({ agent_id: agent!.id, suite_id: suite!.id }) });
  const runId = ((await started.json()) as { run?: { id: string } }).run?.id;
  report(started.status === 201 && Boolean(runId), "a run starts through the API", String(started.status));

  const slices: number[] = [];
  let done = false;
  while (!done && slices.length < 10) {
    const t = Date.now();
    const res = await fetch(`${base}/api/v1/runs/${runId}/execute`, { method: "POST", headers });
    const body = (await res.json()) as { done?: boolean; graded?: number; status?: string };
    slices.push(Date.now() - t);
    console.log(`       slice ${slices.length}: ${slices.at(-1)} ms, ${body.status}, ${body.graded ?? "?"} graded`);
    done = body.done === true;
  }

  const slowest = Math.max(...slices);
  report(done, "the run finishes", `${slices.length} slice(s)`);
  report(slowest < SAFE_MS, `every slice hands back before ${SAFE_MS / 1000} s (the function dies at ${CEILING_MS / 1000})`, `slowest ${slowest} ms`);
  report(slices.length >= 2, "a slow agent takes more than one slice rather than overrunning one");

  const { data: stored } = await db.from("run_cases").select("case_id, status, error").eq("run_id", runId!);
  report(stored?.length === cases.length, "every scenario is recorded exactly once", `${stored?.length}/${cases.length}`);
  const cut = (stored ?? []).filter((c) => /time slice was ending/.test(String(c.error)));
  report(cut.length === 0, "no scenario was cut short by Novera's own budget", cut.map((c) => c.case_id).join(", "));
  const agentErrors = (stored ?? []).filter((c) => c.status === "error" && /response path/.test(String(c.error)));
  const others = (stored ?? []).filter((c) => !agentErrors.includes(c)).map((c) => `${c.case_id}: ${String(c.error ?? c.status).slice(0, 90)}`);
  report(agentErrors.length === cases.length, "each one reached the agent and waited for its reply",
    `${agentErrors.length} answered${others.length ? `; ${others.join("; ")}` : ""}`);

  // Grading capacity (0041): at most two slices grade on the shared trial keys at once.
  // Three runs driven together — the third is told to wait, then starts when a slot frees.
  const extra = await Promise.all([1, 2, 3].map(async (i) => {
    const u = (await db.auth.admin.createUser({ email: `verify-slices-${i}+${Date.now()}@novera.invalid`, password: crypto.randomUUID(), email_confirm: true })).data.user!;
    const { data: w } = await db.from("workspaces").insert({ name: "__novera_verify_slices__", owner_id: u.id }).select("id").single();
    made.push({ ws: w!.id, user: u.id });
    await db.from("workspace_members").insert({ workspace_id: w!.id, user_id: u.id, role: "owner" });
    const { data: a } = await db.from("agents").insert({ workspace_id: w!.id, name: "slow", kind: "http", is_production: false,
      config: { kind: "http", url: "https://httpbin.org/delay/10", bodyTemplate: { message: "{{input}}" }, responsePath: "reply" } }).select("id").single();
    await db.from("policies").insert({ workspace_id: w!.id, agent_id: a!.id, version: 1, body: "x" });
    const { data: su } = await db.from("suites").insert({ workspace_id: w!.id, key: "slices", version: 1, name: "slices", cases: cases.slice(0, 3) }).select("id").single();
    const k = mintKey();
    await db.from("api_keys").insert({ workspace_id: w!.id, name: "s", prefix: k.prefix, key_hash: k.hash, scopes: ["read", "run"], created_by: u.id });
    const h = { authorization: `Bearer ${k.key}`, "content-type": "application/json" };
    const r = await fetch(`${base}/api/v1/runs`, { method: "POST", headers: h, body: JSON.stringify({ agent_id: a!.id, suite_id: su!.id }) });
    return { headers: h, runId: ((await r.json()) as { run: { id: string } }).run.id, user: u.id };
  }));
  const firstCalls = await Promise.all(extra.map(async (e, i) => {
    await new Promise((r) => setTimeout(r, i * 400));
    const res = await fetch(`${base}/api/v1/runs/${e.runId}/execute`, { method: "POST", headers: e.headers });
    return (await res.json()) as { started?: boolean; waiting?: string; done?: boolean };
  }));
  const waited = firstCalls.filter((b) => b.waiting === "grading_capacity").length;
  report(waited === 1 && firstCalls.filter((b) => b.started).length === 2, "with two grading slots taken, the third trial run is told to wait, not refused",
    JSON.stringify(firstCalls.map((b) => b.waiting ?? (b.started ? "started" : "held"))));
  const waiter = extra[firstCalls.findIndex((b) => b.waiting === "grading_capacity")];
  const later = waiter ? (await (await fetch(`${base}/api/v1/runs/${waiter.runId}/execute`, { method: "POST", headers: waiter.headers })).json()) as { started?: boolean } : null;
  report(later?.started === true, "once a slot is free, the waiting run starts");

  // Stopped while a slice is grading: it stays stopped, nothing is sealed, and no new
  // scenario is sent to the agent after the stop.
  const again = await fetch(`${base}/api/v1/runs`, { method: "POST", headers, body: JSON.stringify({ agent_id: agent!.id, suite_id: suite!.id }) });
  const stopId = ((await again.json()) as { run?: { id: string } }).run?.id;
  const slice = fetch(`${base}/api/v1/runs/${stopId}/execute`, { method: "POST", headers }).then((r) => r.json());
  await new Promise((r) => setTimeout(r, 4_000));
  await db.from("runs").update({ status: "aborted", error: "Stopped by the verification before it finished.", finished_at: new Date().toISOString(), lease_until: null, stopped_by: user.id })
    .eq("id", stopId!).in("status", ["queued", "running"]);
  const sliceStarted = Date.now();
  const answer = (await slice) as { status?: string };
  const { data: after } = await db.from("runs").select("status, stopped_by").eq("id", stopId!).single();
  const { count: reports } = await db.from("reports").select("id", { count: "exact", head: true }).eq("run_id", stopId!);
  const { count: sent } = await db.from("run_cases").select("id", { count: "exact", head: true }).eq("run_id", stopId!);
  report(after?.status === "aborted" && after.stopped_by === user.id && (reports ?? 0) === 0 && answer.status === "aborted",
    "a run stopped while a slice is grading stays stopped, names who stopped it, and seals no report", `${after?.status}, ${reports} report(s)`);
  report((sent ?? 0) <= 3 && Date.now() - sliceStarted < 15_000,
    "after the stop, only the scenarios already sent finish; no new one goes to the agent", `${sent} recorded of ${cases.length}`);
} finally {
  await db.rpc("erase_workspace", { target: ws!.id });
  await db.auth.admin.deleteUser(user.id);
  for (const m of made) {
    await db.rpc("erase_workspace", { target: m.ws });
    await db.auth.admin.deleteUser(m.user);
  }
  console.log(`  removed ${1 + made.length} verification workspace(s) and their users`);
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
