/**
 * How the grading pipeline holds up when several customers run at once — measured, so
 * nothing about capacity is promised on a guess.
 *
 * For each concurrency level (default 1, 2, 4) it starts that many runs at the same
 * moment, each in its own throwaway workspace on the trial allowance (our own grading
 * keys, the shared free tiers), against the scripted fixture agent, and drives them all
 * through the public API as a pipeline would. Then it reads the stored rows: wall time,
 * scenarios with no result, and per vendor the calls, rate limits, timeouts, breaker
 * skips and latency. The fixture answers instantly, so the only thing being measured
 * is grading.
 *
 * Costs real quota: about 2–3 model calls per scenario per run. One sweep, then stop.
 * Needs `npm run dev`.
 *   npm run measure:throughput
 *   THROUGHPUT_LEVELS=1,2 THROUGHPUT_CASES=8 npm run measure:throughput
 */
import { createClient } from "@supabase/supabase-js";
import { mintKey } from "../src/lib/api/keys.ts";

const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const LEVELS = (process.env.THROUGHPUT_LEVELS ?? "1,2,4").split(",").map(Number).filter((n) => n > 0);
const CASES = Number(process.env.THROUGHPUT_CASES ?? 12);
const REST_BETWEEN_LEVELS_MS = 60_000;

interface Attempt { connection: string; ok: boolean; ms: number; reason?: string }

const { data: builtIn } = await db.from("suites").select("cases").eq("key", "eu-support").eq("version", 4).is("workspace_id", null).single();
const cases = (builtIn!.cases as Array<Record<string, unknown>>)
  .filter((c) => !c.earlier_turns && !c.persona && !c.destructive && !c.fixture_only)
  .slice(0, CASES);

const made: Array<{ ws: string; user: string }> = [];

async function workspace(tag: string) {
  const user = (await db.auth.admin.createUser({ email: `measure-throughput-${tag}+${Date.now()}@novera.invalid`, password: crypto.randomUUID(), email_confirm: true })).data.user!;
  const { data: ws } = await db.from("workspaces").insert({ name: `__novera_measure_${tag}__`, owner_id: user.id }).select("id").single();
  made.push({ ws: ws!.id, user: user.id });
  await db.from("workspace_members").insert({ workspace_id: ws!.id, user_id: user.id, role: "owner" });
  const { data: agent } = await db.from("agents").insert({
    workspace_id: ws!.id, name: "fixture", kind: "http", is_production: false,
    config: { kind: "http", url: `${base}/api/test-agent`, bodyTemplate: { message: "{{input}}", context: "{{context}}" }, responsePath: "reply", toolActivityPath: "tool_calls" },
  }).select("id").single();
  await db.from("policies").insert({ workspace_id: ws!.id, agent_id: agent!.id, version: 1, body: "Answer from the documentation. Refunds within 30 days with a receipt. Verify identity before any account change. Escalate what you cannot do." });
  const { data: suite } = await db.from("suites").insert({ workspace_id: ws!.id, key: "throughput", version: 1, name: "throughput", cases }).select("id").single();
  const k = mintKey();
  await db.from("api_keys").insert({ workspace_id: ws!.id, name: "throughput", prefix: k.prefix, key_hash: k.hash, scopes: ["read", "run"], created_by: user.id });
  return { agent: agent!.id as string, suite: suite!.id as string, key: k.key };
}

async function drive(w: { agent: string; suite: string; key: string }) {
  const headers = { authorization: `Bearer ${w.key}`, "content-type": "application/json" };
  const t0 = Date.now();
  const res = await fetch(`${base}/api/v1/runs`, { method: "POST", headers, body: JSON.stringify({ agent_id: w.agent, suite_id: w.suite }) });
  const runId = ((await res.json()) as { run?: { id: string } }).run?.id;
  if (!runId) throw new Error(`could not start a run: ${res.status}`);
  let slices = 0;
  let slowestSlice = 0;
  for (let done = false; !done && slices < 40;) {
    const s = Date.now();
    const r = await fetch(`${base}/api/v1/runs/${runId}/execute`, { method: "POST", headers });
    const body = (await r.json()) as { done?: boolean; started?: boolean };
    slowestSlice = Math.max(slowestSlice, Date.now() - s);
    if (body.started !== false) slices++;
    done = body.done === true;
    if (!done && body.started === false) await new Promise((r2) => setTimeout(r2, 2_000));
  }
  return { runId, wallMs: Date.now() - t0, slices, slowestSlice };
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

try {
  console.log(`${cases.length} scenarios per run, fixture agent, trial allowance (our grading keys).\n`);
  for (const [i, level] of LEVELS.entries()) {
    if (i > 0) {
      console.log(`  resting ${REST_BETWEEN_LEVELS_MS / 1000} s so the free tiers' windows reset between levels…\n`);
      await new Promise((r) => setTimeout(r, REST_BETWEEN_LEVELS_MS));
    }
    const setups = await Promise.all(Array.from({ length: level }, (_, j) => workspace(`${level}x${j}`)));
    const started = Date.now();
    const runs = await Promise.all(setups.map(drive));
    const total = Date.now() - started;

    const { data: rows } = await db.from("run_cases").select("run_id, case_id, status, error, judge_attempts, judge_agreement, judge_votes, settled_by").in("run_id", runs.map((r) => r.runId));
    const noResult = (rows ?? []).filter((r) => r.status === "error").length;
    const byVendor = new Map<string, { calls: number; ok: number; limited: number; timedOut: number; skipped: number; other: number; ms: number[] }>();
    for (const row of rows ?? []) {
      for (const a of (row.judge_attempts as Attempt[] | null) ?? []) {
        const v = byVendor.get(a.connection) ?? { calls: 0, ok: 0, limited: 0, timedOut: 0, skipped: 0, other: 0, ms: [] };
        if (a.reason === "skipped_open_circuit") v.skipped++;
        else {
          v.calls++;
          if (a.ok) { v.ok++; v.ms.push(a.ms); }
          else if (a.reason === "rate_limited") v.limited++;
          else if (a.reason === "timed_out") v.timedOut++;
          else v.other++;
        }
        byVendor.set(a.connection, v);
      }
    }

    console.log(`${level} run(s) at once — all done in ${(total / 1000).toFixed(1)} s`);
    for (const r of runs) console.log(`  run ${r.runId.slice(0, 8)}: ${(r.wallMs / 1000).toFixed(1)} s, ${r.slices} slice(s), slowest slice ${(r.slowestSlice / 1000).toFixed(1)} s`);
    console.log(`  scenarios: ${rows?.length ?? 0} recorded of ${level * cases.length}, ${noResult} with no result`);
    const how = new Map<string, number>();
    for (const r of rows ?? []) {
      const votes = (r.judge_votes as Array<{ model?: string; status?: string }> | null) ?? [];
      const vendors = new Set(votes.filter((v) => v.status !== "error" && v.model).map((v) => String(v.model).split("/")[0]));
      const key = r.status === "error" ? "no result" : r.settled_by === "deterministic" ? "settled by rules"
        : `${r.judge_agreement}${vendors.size > 1 ? " across vendors" : vendors.size === 1 ? " within one vendor" : ""}`;
      how.set(key, (how.get(key) ?? 0) + 1);
    }
    console.log(`  how verdicts were reached: ${[...how].map(([k, n]) => `${n} ${k}`).join(", ")}`);
    for (const r of (rows ?? []).filter((x) => x.status === "error")) console.log(`    ${r.case_id} no result: ${String(r.error).slice(0, 220)}`);
    for (const [name, v] of byVendor) {
      console.log(`  ${name.padEnd(10)} ${v.calls} calls: ${v.ok} ok, ${v.limited} rate-limited, ${v.timedOut} timed out, ${v.other} other; ${v.skipped} skipped by the breaker; p50 ${pct(v.ms, 50)} ms, p95 ${pct(v.ms, 95)} ms`);
    }
    console.log("");
  }
} finally {
  for (const m of made) {
    await db.rpc("erase_workspace", { target: m.ws });
    await db.auth.admin.deleteUser(m.user);
  }
  console.log(`removed ${made.length} measurement workspace(s) and their users`);
}
