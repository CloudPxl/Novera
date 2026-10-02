/**
 * Proves that a slice which has lost its run's lease stops: it sends the customer's agent
 * no new scenario, saves nothing, and can neither release nor abort the run another slice
 * now holds; and that the slice which took over finishes the run instead of aborting on a
 * scenario the first one recorded (audit 2026-09-30, C4).
 *
 * What it cannot prove, because nothing can: a scenario already in flight when the lease
 * was taken over may reach the agent twice — once from each slice. Novera cannot know
 * whether the agent acted on the first, and an agent that takes no idempotency key and
 * returns no receipt gives it no way to find out. Only the scenarios in flight at that
 * moment, at most the runner's concurrency, can be sent twice; the last check measures it.
 *
 * Against the running app, with a counting agent of our own on loopback. No model is
 * called: the agent's replies carry nothing at the response path. Free.
 * Needs `npm run dev`. Run: npm run verify:leases
 */
import { createServer } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { mintKey } from "../src/lib/api/keys.ts";
import { supabaseRunStore } from "../src/lib/store/supabase-run-store.ts";
import { abortHeldRun } from "../src/lib/workflow/start-run.ts";

const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

let failures = 0;
function report(ok: boolean, label: string, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// The customer's agent: records every scenario it receives, answers after `delayMs`.
const calls: string[] = [];
let delayMs = 3_000;
const agent = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    try { calls.push(String(JSON.parse(body).message)); } catch { calls.push("?"); }
    setTimeout(() => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ text: "unreadable on purpose" })); }, delayMs);
  });
});
await new Promise<void>((r) => agent.listen(0, "127.0.0.1", r));
const agentUrl = `http://127.0.0.1:${(agent.address() as { port: number }).port}/chat`;

const user = (await db.auth.admin.createUser({ email: `verify-leases+${Date.now()}@novera.invalid`, password: crypto.randomUUID(), email_confirm: true })).data.user!;
const { data: ws } = await db.from("workspaces").insert({ name: "__novera_verify_leases__", owner_id: user.id }).select("id").single();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

try {
  await db.from("workspace_members").insert({ workspace_id: ws!.id, user_id: user.id, role: "owner" });
  const { data: agentRow } = await db.from("agents").insert({
    workspace_id: ws!.id, name: "counting agent", kind: "http", is_production: false,
    config: { kind: "http", url: agentUrl, bodyTemplate: { message: "{{input}}" }, responsePath: "reply" },
  }).select("id").single();
  await db.from("policies").insert({ workspace_id: ws!.id, agent_id: agentRow!.id, version: 1, body: "Answer from the documentation only." });
  const { data: v5 } = await db.from("suites").select("cases").eq("key", "eu-support").eq("version", 5).is("workspace_id", null).single();
  const cases = (v5!.cases as Array<Record<string, unknown>>)
    .filter((c) => !c.earlier_turns && !c.persona && !c.context && !c.destructive && !c.fixture_only).slice(0, 6);
  const { data: suite } = await db.from("suites").insert({ workspace_id: ws!.id, key: "leases", version: 1, name: "leases", cases }).select("id").single();
  const k = mintKey();
  await db.from("api_keys").insert({ workspace_id: ws!.id, name: "leases", prefix: k.prefix, key_hash: k.hash, scopes: ["read", "run"], created_by: user.id });
  const headers = { authorization: `Bearer ${k.key}`, "content-type": "application/json" };
  const start = async () => ((await (await fetch(`${base}/api/v1/runs`, { method: "POST", headers, body: JSON.stringify({ agent_id: agentRow!.id, suite_id: suite!.id }) })).json()) as { run: { id: string } }).run.id;
  const execute = async (runId: string) => (await (await fetch(`${base}/api/v1/runs/${runId}/execute`, { method: "POST", headers })).json()) as Record<string, unknown>;
  const runState = async (runId: string) => (await db.from("runs").select("status, error, lease_until, lease_token").eq("id", runId).single()).data as Record<string, unknown> | null;
  const rows = async (runId: string) => (await db.from("run_cases").select("case_id").eq("run_id", runId)).data ?? [];

  // ---------------------------------------------------------------- 1. a stale slice stops
  console.log("\nA slice that loses its lease");
  delayMs = 3_000;
  calls.length = 0;
  const run1 = await start();
  const slice = execute(run1);
  await sleep(1_000);
  const inFlight = calls.length;
  // Another slice takes the run over: its own token and a fresh lease, as claim_run_slice_fenced writes them.
  const usurper = crypto.randomUUID();
  const lease = new Date(Date.now() + 60_000).toISOString();
  const { error: plantError } = await db.from("runs").update({ lease_token: usurper, lease_until: lease }).eq("id", run1);
  const answered = await slice;
  await sleep(4_000);
  const after = await runState(run1);
  report(!plantError && calls.length === inFlight, "it sends the agent no scenario after the takeover",
    plantError ? plantError.message : `${inFlight} in flight at the takeover, ${calls.length} sent in all, of ${cases.length}`);
  report((await rows(run1)).length === 0, "it saves nothing: the slice holding the run records its own", `${(await rows(run1)).length} row(s)`);
  report(after?.lease_token === usurper && after?.lease_until !== null, "its release leaves the other slice's lease alone", JSON.stringify({ token: after?.lease_token === usurper ? "the usurper's" : after?.lease_token, lease_until: after?.lease_until }));
  report(after?.status === "running", "it does not finish or abort a run it no longer holds", `${after?.status}; it answered ${JSON.stringify(answered).slice(0, 120)}`);

  const staleAbort = await abortHeldRun(db, ws!.id, run1, crypto.randomUUID(), "a stale slice failed");
  report(!staleAbort && (await runState(run1))?.status === "running", "an abort from a slice without the lease changes nothing", `abort applied: ${staleAbort}`);
  const liveAbort = await abortHeldRun(db, ws!.id, run1, usurper, "the holding slice failed");
  report(liveAbort && (await runState(run1))?.status === "aborted", "the slice that holds the lease can still abort", `abort applied: ${liveAbort}`);

  // ---------------------------------------------------------------- 2. the duplicate-row path
  console.log("\nA scenario recorded twice");
  const run2 = await start();
  const token2 = crypto.randomUUID();
  await db.from("runs").update({ status: "running", lease_token: token2, lease_until: new Date(Date.now() + 60_000).toISOString() }).eq("id", run2);
  const store = supabaseRunStore(db, ws!.id, { leaseToken: token2 });
  const record = {
    runId: run2, caseId: String(cases[0].id), category: String(cases[0].category), obligation: String(cases[0].obligation), severity: String(cases[0].severity),
    input: "x", expected: "y", assertions: ["a"], responseText: null, toolActivity: null, status: "error" as const, rationale: null,
    latencyMs: 1, usage: null, judgeModel: null, judgeAttempts: [], judgeVotes: [], judgeAgreement: null, failedAssertions: [], evidenceGap: null,
    settledBy: null, error: "planted",
  };
  let firstSave = "saved", secondSave = "saved";
  try { firstSave = String(await store.saveCase(record as never) ?? "saved"); } catch (e) { firstSave = `threw: ${(e as Error).message}`; }
  try { secondSave = String(await store.saveCase(record as never) ?? "saved"); } catch (e) { secondSave = `threw: ${(e as Error).message}`; }
  report(firstSave === "saved" && secondSave === "already_recorded" && (await rows(run2)).length === 1,
    "a second save of a recorded scenario is 'already recorded', not an error that aborts the run", `${firstSave}; then ${secondSave}`);
  const stale = supabaseRunStore(db, ws!.id, { leaseToken: crypto.randomUUID() });
  let staleSave = "saved";
  try { staleSave = String(await stale.saveCase({ ...record, caseId: String(cases[1].id) } as never) ?? "saved"); } catch (e) { staleSave = `threw: ${(e as Error).message}`; }
  report(staleSave === "not_holder" && (await rows(run2)).length === 1, "a slice without the lease cannot save a scenario", staleSave);

  // ---------------------------------------------------------------- 3. a real takeover finishes the run
  console.log("\nA takeover, end to end");
  delayMs = 4_000;
  calls.length = 0;
  const run3 = await start();
  const first = execute(run3);
  await sleep(1_000);
  const atTakeover = calls.length;
  // The first slice outlives its lease (a hung call, a raised maxDuration, a self-hosted server).
  await db.from("runs").update({ lease_until: new Date(Date.now() - 1_000).toISOString() }).eq("id", run3);
  const second = execute(run3);
  const [a, b] = await Promise.all([first, second]);
  let state = await runState(run3);
  for (let i = 0; i < 10 && state?.status === "running"; i++) { await execute(run3); state = await runState(run3); }
  const recorded = (await rows(run3)).map((r) => r.case_id as string);
  const twice = [...new Set(calls.filter((c, i) => calls.indexOf(c) !== i))];
  report(state?.status === "completed" && recorded.length === cases.length && new Set(recorded).size === cases.length,
    "the run completes with every scenario recorded once", `${state?.status}${state?.error ? ` (${String(state.error).slice(0, 80)})` : ""}; ${recorded.length} row(s); slices ${JSON.stringify(a).slice(0, 60)} | ${JSON.stringify(b).slice(0, 60)}`);
  report(twice.length <= atTakeover, "only scenarios already in flight at the takeover reach the agent twice",
    `${atTakeover} in flight; ${twice.length} sent twice; ${calls.length} calls for ${cases.length} scenarios`);
} finally {
  await db.rpc("erase_workspace", { target: ws!.id });
  await db.auth.admin.deleteUser(user.id);
  agent.close();
  console.log("  removed the verification workspace and user");
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
