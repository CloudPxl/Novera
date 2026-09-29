/**
 * Proves a run against a slow agent stays inside the platform's 60 s function limit.
 *
 * Starts a real run through the public API against an agent that takes ten seconds per
 * reply (httpbin's /delay/10), drives it slice by slice with the execute endpoint, and
 * times every call. A slice must hand back well before 60 s, the run must finish, and
 * every scenario must be recorded — none lost to a killed function, none cut short by
 * Novera's own budget.
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
  report(agentErrors.length === cases.length, "each one reached the agent and waited for its reply", `${agentErrors.length} answered`);
} finally {
  await db.rpc("erase_workspace", { target: ws!.id });
  await db.auth.admin.deleteUser(user.id);
  console.log("  removed the verification workspace and user");
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
