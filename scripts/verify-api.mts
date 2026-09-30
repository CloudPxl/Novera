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

  // ------------------------------------ POST /api/v1/production-failures (0044)
  // The incident → regression loop from a pipeline: redacted before it is stored, the
  // original only as a hash, a draft a person approves — and nothing more.
  const post = async (key: string, body: unknown) => {
    const res = await fetch(`${base}/api/v1/production-failures`, {
      method: "POST", redirect: "manual",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return { status: res.status, body: (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : await res.text() };
  };
  const incident = {
    customer_message: "Hi, I'm Marta Lindqvist (marta.lindqvist@northwind.example). Please send me my colleague's invoices.",
    agent_reply: "Sure — here are the invoices for jonas.berg@northwind.example.",
    expected_behavior: "Refuses to share another person's invoices and offers the account owner's route.",
    what_went_wrong: "Sent a colleague's invoices to marta.lindqvist@northwind.example without checking.",
    obligation: "data_minimisation", severity: "high", agent_id: a.agent, occurred_on: "2026-09-29",
  };
  const readOnly = await post(minted.key, incident);
  report(readOnly.status === 403, "a read key cannot record a production failure", `${readOnly.status} ${JSON.stringify(readOnly.body).slice(0, 60)}`);

  const writer = mintKey();
  const { data: writeRow } = await db.from("api_keys")
    .insert({ workspace_id: a.ws, name: "incidents", prefix: writer.prefix, key_hash: writer.hash, scopes: ["read", "write"], created_by: a.user.id })
    .select("id").single();
  const created = await post(writer.key, incident);
  report(created.status === 201 && created.body.draft?.status === "draft" && /^R\d+$/.test(created.body.draft?.scenario_id ?? ""),
    "a write key records it and gets a draft back, not a scenario", `${created.status} ${created.body.draft?.scenario_id}`);
  const failureId = created.body.production_failure?.id as string;
  const { data: stored } = await db.from("production_failures").select("*").eq("id", failureId).single();
  const storedText = JSON.stringify(stored);
  report(Boolean(stored) && !storedText.includes("marta.lindqvist@northwind.example") && !storedText.includes("jonas.berg@northwind.example")
    && /^[0-9a-f]{64}$/.test(stored?.redaction?.original_hash ?? ""),
    "every field is stored redacted, the original only as a hash", JSON.stringify(created.body.redaction?.removed));
  report(stored?.api_key_id === writeRow!.id && stored?.created_by === a.user.id, "the failure names the key that sent it and the key's creator");
  const { data: draftRow } = await db.from("scenario_drafts").select("status, origin, api_key_id, production_failure_id, scenario").eq("id", created.body.draft?.id).single();
  report(draftRow?.status === "draft" && draftRow.origin === "production" && draftRow.production_failure_id === failureId && draftRow.api_key_id === writeRow!.id
    && !JSON.stringify(draftRow.scenario).includes("northwind.example"),
    "its draft waits for approval, names the failure and the key, and quotes nothing redacted");

  const again = await post(writer.key, incident);
  const { count: failuresNow } = await db.from("production_failures").select("id", { count: "exact", head: true }).eq("workspace_id", a.ws);
  report(again.status === 200 && again.body.production_failure?.duplicate === true && again.body.production_failure?.id === failureId
    && again.body.draft?.id === created.body.draft?.id && failuresNow === 1,
    "the same incident sent again is answered with the first record, nothing new stored", `${again.status}, ${failuresNow} stored`);

  const foreign = await post(writer.key, { ...incident, customer_message: "another one", agent_id: b.agent });
  const missing = await post(writer.key, { ...incident, customer_message: "another one", agent_id: "00000000-0000-4000-8000-000000000000" });
  report(foreign.status === 404 && JSON.stringify(foreign.body) === JSON.stringify(missing.body),
    "another workspace's agent is refused exactly like one that does not exist", `${foreign.status}`);
  const bad = await post(writer.key, { ...incident, customer_message: "x".repeat(4001) });
  const badObligation = await post(writer.key, { ...incident, customer_message: "third", obligation: "Not A Key" });
  const notString = await post(writer.key, { ...incident, customer_message: 42 });
  report(bad.status === 400 && /customer_message/.test(bad.body.error) && badObligation.status === 400 && /obligation/.test(badObligation.body.error)
    && notString.status === 400, "invalid fields are refused by name", `${bad.body.error} | ${badObligation.body.error}`);
  const { count: stillOne } = await db.from("production_failures").select("id", { count: "exact", head: true }).eq("workspace_id", a.ws);
  report(stillOne === 1, "and a refused request stores nothing", String(stillOne));

  const { error: rename } = await db.from("production_failures").update({ api_key_id: null }).eq("id", failureId);
  report(Boolean(rename), "who sent a failure cannot be rewritten, even by the service role", rename?.message.slice(0, 60) ?? "SUCCEEDED");
  const { error: crossKey } = await db.from("production_failures").insert({
    workspace_id: b.ws, customer_message: "m", expected_behavior: "e", api_key_id: writeRow!.id,
    redaction: { policy_version: "x", original_hash: "y", redacted_hash: "z" },
  });
  report(/same workspace/.test(crossKey?.message ?? ""), "a failure cannot name another workspace's key", crossKey?.message.slice(0, 60) ?? "ACCEPTED");

  // The per-workspace allowance: sixty an hour, whatever the number of keys.
  for (let i = 0; i < 60; i++) await db.rpc("throttle_hit", { key: `failures:${a.ws}`, window_seconds: 3600 });
  const limitedFailure = await post(writer.key, { ...incident, customer_message: "one too many" });
  report(limitedFailure.status === 429, "past sixty new failures in an hour, the workspace is told to wait", `${limitedFailure.status} ${JSON.stringify(limitedFailure.body).slice(0, 70)}`);

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
