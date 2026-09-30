/**
 * Proves the workspace API key and the read API against the live database and a running
 * app: refusals in the shape an API caller reads, one workspace per key, revocation that
 * takes effect on the next request, a hash no browser can read, a rate limit, erasure.
 *
 * Needs `npm run dev`. Free: no model is called.
 * Run: npm run verify:api
 */
import { createClient } from "@supabase/supabase-js";
import { mintKey } from "../src/lib/api/keys.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

let failures = 0;
function report(ok: boolean, label: string, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const call = async (path: string, key?: string) => {
  const res = await fetch(`${base}${path}`, { redirect: "manual", headers: key ? { authorization: `Bearer ${key}` } : {} });
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, type, body: type.includes("json") ? await res.json() : await res.text() };
};

const password = crypto.randomUUID();
const makeWorkspace = async (tag: string) => {
  const user = (await db.auth.admin.createUser({ email: `verify-api-${tag}+${Date.now()}@novera.invalid`, password, email_confirm: true })).data.user!;
  const { data: ws } = await db.from("workspaces").insert({ name: `__novera_verify_${tag}__`, owner_id: user.id }).select("id").single();
  await db.from("workspace_members").insert({ workspace_id: ws!.id, user_id: user.id, role: "owner" });
  const { data: agent } = await db.from("agents").insert({ workspace_id: ws!.id, name: `agent-${tag}`, kind: "http", config: { url: `https://${tag}.example/chat` } }).select("id").single();
  const { data: policy } = await db.from("policies").insert({ workspace_id: ws!.id, agent_id: agent!.id, version: 1, body: `SECRET POLICY TEXT ${tag}` }).select("id").single();
  const { data: suite } = await db.from("suites").select("id").is("workspace_id", null).limit(1).single();
  // Created running, completed after its cases, as the runner does: a completed run takes no new evidence (0043).
  const { data: run } = await db.from("runs").insert({ workspace_id: ws!.id, agent_id: agent!.id, policy_id: policy!.id, suite_id: suite!.id, status: "running" }).select("id").single();
  await db.from("run_cases").insert([
    { workspace_id: ws!.id, run_id: run!.id, case_id: "T01", category: "c", obligation: "policy_accuracy", severity: "low", input: "hi", expected: "x", assertions: ["a"], response_text: `reply ${tag}`, status: "pass" },
    { workspace_id: ws!.id, run_id: run!.id, case_id: "T02", category: "c", obligation: "policy_accuracy", severity: "low", input: "hi", expected: "x", assertions: ["a"], status: "error", error: "HTTP 502" },
  ]);
  await db.from("runs").update({ status: "completed" }).eq("id", run!.id);
  return { user, ws: ws!.id as string, agent: agent!.id as string, run: run!.id as string };
};

const a = await makeWorkspace("a");
const b = await makeWorkspace("b");

try {
  const minted = mintKey();
  const { data: keyRow, error: keyErr } = await db.from("api_keys")
    .insert({ workspace_id: a.ws, name: "verify", prefix: minted.prefix, key_hash: minted.hash, scopes: ["read"], created_by: a.user.id })
    .select("id").single();
  report(!keyErr, "a key is stored as a fingerprint", keyErr?.message ?? minted.prefix);

  const none = await call("/api/v1/runs");
  report(none.status === 401 && none.type.includes("json"), "no key: a JSON 401, not a redirect", `${none.status} ${none.type}`);
  const malformed = await call("/api/v1/runs", "not-a-key");
  report(malformed.status === 401, "a malformed key is refused", String(malformed.status));
  const unknown = await call("/api/v1/runs", mintKey().key);
  report(unknown.status === 401 && JSON.stringify(unknown.body) === JSON.stringify(malformed.body),
    "an unknown key gets the same answer as a malformed one", String(unknown.status));

  const agents = await call("/api/v1/agents", minted.key);
  const names = (agents.body.agents ?? []).map((x: { name: string }) => x.name);
  report(agents.status === 200 && names.length === 1 && names[0] === "agent-a", "a key sees only its own workspace's agents", names.join(", "));
  report(!JSON.stringify(agents.body).includes("SECRET POLICY TEXT"), "policy text is never returned");

  const runs = await call("/api/v1/runs", minted.key);
  const own = (runs.body.runs ?? []).map((r: { id: string }) => r.id);
  report(own.length === 1 && own[0] === a.run, "a key sees only its own workspace's runs", `${own.length} run(s)`);
  report(JSON.stringify(runs.body.runs?.[0]?.counts) === JSON.stringify({ passed: 1, failed: 0, no_result: 1 }),
    "counts come from the stored cases, and no result is never a pass", JSON.stringify(runs.body.runs?.[0]?.counts));

  const theirs = await call(`/api/v1/runs/${b.run}`, minted.key);
  report(theirs.status === 404, "another workspace's run does not exist for this key", String(theirs.status));
  const bogus = await call("/api/v1/runs/not-a-uuid", minted.key);
  report(bogus.status === 404 && JSON.stringify(bogus.body) === JSON.stringify(theirs.body), "a malformed id gets the same 404");

  const detail = await call(`/api/v1/runs/${a.run}`, minted.key);
  report(detail.status === 200 && detail.body.run.cases.length === 2 && !("response" in detail.body.run.cases[0]),
    "a run's scenarios are listed without the agent's words unless asked");
  const withResponses = await call(`/api/v1/runs/${a.run}?include=responses`, minted.key);
  report(withResponses.body.run?.cases?.[0]?.response === "reply a", "and with them when asked");

  // Row-level security through a real session: members read keys, never their hash.
  const member = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  await member.auth.signInWithPassword({ email: a.user.email!, password });
  const { error: hashErr } = await member.from("api_keys").select("key_hash").eq("id", keyRow!.id);
  report(!!hashErr, "a signed-in member cannot read a key's hash", hashErr?.message.slice(0, 60) ?? "READABLE");
  const { data: visible } = await member.from("api_keys").select("id, prefix").eq("id", keyRow!.id);
  report((visible ?? []).length === 1, "but can see the key exists");
  const { error: memberInsert } = await member.from("api_keys").insert({ workspace_id: a.ws, name: "x", prefix: "nvk_x", key_hash: "ff", created_by: a.user.id });
  report(!!memberInsert, "a browser cannot create a key directly", memberInsert?.message.slice(0, 60) ?? "SUCCEEDED");

  const { error: renameErr } = await db.from("api_keys").update({ name: "renamed" }).eq("id", keyRow!.id);
  report(!!renameErr, "a key cannot be changed, even by the service role", renameErr?.message.slice(0, 60) ?? "SUCCEEDED");
  const { error: scopeErr } = await db.from("api_keys").update({ scopes: ["read", "write"] }).eq("id", keyRow!.id);
  report(!!scopeErr, "or given a scope that does not exist", scopeErr?.message.slice(0, 60) ?? "SUCCEEDED");

  // The limit: 120 a minute, in windows aligned to the clock minute. One burst, away from
  // a boundary — sequential requests take long enough to straddle one, and a test that
  // does is measuring two windows and passing neither. (It did, the first time.)
  const second = new Date().getSeconds();
  if (second > 40) await new Promise((r) => setTimeout(r, (61 - second) * 1000));
  const burst = await Promise.all(Array.from({ length: 125 }, () => call("/api/v1/suites", minted.key)));
  const limited = burst.filter((r) => r.status === 429);
  report(limited.length >= 1 && limited.every((r) => r.type.includes("json")),
    "past 120 requests in a minute, a key is refused with a JSON 429", `${limited.length} of 125 refused`);

  const { error: revokeErr } = await db.from("api_keys").update({ revoked_at: new Date().toISOString(), revoked_by: a.user.id }).eq("id", keyRow!.id);
  const afterRevoke = await call("/api/v1/agents", minted.key);
  report(!revokeErr && afterRevoke.status === 401, "a revoked key is refused on the very next request", String(afterRevoke.status));
  const { error: unrevokeErr } = await db.from("api_keys").update({ revoked_at: null, revoked_by: null }).eq("id", keyRow!.id);
  report(!!unrevokeErr, "and stays revoked", unrevokeErr?.message.slice(0, 60) ?? "SUCCEEDED");

  const { error: eraseErr } = await db.rpc("erase_workspace", { target: a.ws });
  const { count } = await db.from("api_keys").select("*", { count: "exact", head: true }).eq("workspace_id", a.ws);
  report(!eraseErr && count === 0, "erasure removes the workspace's keys", eraseErr?.message ?? `${count} left`);
} finally {
  await db.rpc("erase_workspace", { target: a.ws });
  await db.rpc("erase_workspace", { target: b.ws });
  await db.auth.admin.deleteUser(a.user.id);
  await db.auth.admin.deleteUser(b.user.id);
  console.log("  removed the verification workspaces and users");
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
