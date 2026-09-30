/**
 * Proves the MCP endpoint with the official MCP client, not only with our own tests:
 * it connects, negotiates, lists read-only tools, and every call is scoped to the key's
 * workspace. Then the scopes: a `run` key and a `write` key are offered exactly their
 * tools, every refusal lands before a model is called, and who asked is frozen on the
 * row. Then the transport rules over raw HTTP — Origin, GET, protocol version.
 *
 * Needs `npm run dev`. Free: no model is called — unless VERIFY_MCP_MODEL=1, which also
 * drafts one scenario and diagnoses one failure for real (two model calls).
 * Run: npm run verify:mcp
 */
import { createClient } from "@supabase/supabase-js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mintKey } from "../src/lib/api/keys.ts";

const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

let failures = 0;
function report(ok: boolean, label: string, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const makeWorkspace = async (tag: string) => {
  const user = (await db.auth.admin.createUser({ email: `verify-mcp-${tag}+${Date.now()}@novera.invalid`, password: crypto.randomUUID(), email_confirm: true })).data.user!;
  const { data: ws } = await db.from("workspaces").insert({ name: `__novera_verify_${tag}__`, owner_id: user.id }).select("id").single();
  const { data: agent } = await db.from("agents").insert({ workspace_id: ws!.id, name: `agent-${tag}`, kind: "http", config: { url: `https://${tag}.example/chat` } }).select("id").single();
  const { data: policy } = await db.from("policies").insert({ workspace_id: ws!.id, agent_id: agent!.id, version: 1, body: `policy ${tag}` }).select("id").single();
  const { data: suite } = await db.from("suites").select("id").is("workspace_id", null).limit(1).single();
  const runs: string[] = [];
  for (const statuses of [["fail", "error"], ["pass", "fail"]]) {
    const { data: run } = await db.from("runs").insert({ workspace_id: ws!.id, agent_id: agent!.id, policy_id: policy!.id, suite_id: suite!.id, status: "completed" }).select("id").single();
    await db.from("run_cases").insert(statuses.map((status, i) => ({
      workspace_id: ws!.id, run_id: run!.id, case_id: `T0${i + 1}`, category: "c", obligation: "policy_accuracy", severity: "low",
      input: "hi", expected: "x", assertions: ["a"], status, ...(status === "error" ? { error: "HTTP 502" } : {}),
    })));
    runs.push(run!.id);
  }
  return { user, ws: ws!.id as string, runs };
};

const a = await makeWorkspace("a");
const b = await makeWorkspace("b");
const minted = mintKey();
await db.from("api_keys").insert({ workspace_id: a.ws, name: "mcp", prefix: minted.prefix, key_hash: minted.hash, scopes: ["read"], created_by: a.user.id });

try {
  const client = new Client({ name: "novera-verify", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${minted.key}` } },
  }));
  report(client.getServerVersion()?.name === "novera", "the official MCP client connects and negotiates", JSON.stringify(client.getServerVersion()));

  const { tools } = await client.listTools();
  report(tools.length === 7 && tools.every((t) => t.annotations?.readOnlyHint === true), "seven tools, all declared read-only", tools.map((t) => t.name).join(", "));

  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as { isError?: boolean; structuredContent?: Record<string, unknown>; content: Array<{ text: string }> };

  const agents = await call("list_agents");
  const names = (agents.structuredContent?.agents as Array<{ name: string }>).map((x) => x.name);
  report(names.length === 1 && names[0] === "agent-a", "list_agents sees only the key's workspace", names.join(", "));

  const runs = await call("list_runs");
  const ids = (runs.structuredContent?.runs as Array<{ id: string }>).map((r) => r.id).sort();
  report(JSON.stringify(ids) === JSON.stringify([...a.runs].sort()), "list_runs sees only the key's workspace", `${ids.length} runs`);

  const theirs = await call("get_run", { run_id: b.runs[0] });
  report(theirs.isError === true && /No such run in this workspace/.test(theirs.content[0].text), "another workspace's run is refused as a tool error");

  const gaps = await call("get_evidence_gaps", { run_id: a.runs[0] });
  const gapList = gaps.structuredContent?.gaps as Array<{ id: string; verdict: string }>;
  report(gapList.length === 1 && gapList[0].verdict === "no_result", "get_evidence_gaps names the scenario with no verdict", JSON.stringify(gapList));

  const cmp = await call("compare_runs", { run_id: a.runs[1], baseline_run_id: a.runs[0] });
  const c = cmp.structuredContent as Record<string, string[]>;
  report(JSON.stringify(c.fixed) === '["T01"]' && JSON.stringify(c.regained_verdict) === '["T02"]',
    "compare_runs: T01 fixed; T02 regained a verdict (as a failure), which is not a fix", JSON.stringify({ fixed: c.fixed, newly_broken: c.newly_broken, regained: c.regained_verdict }));

  const { data: real } = await db.from("reports").select("token").is("revoked_at", null).limit(1).single();
  const verified = await call("verify_report", { report: `${base}/report/${real!.token}` });
  report(verified.structuredContent?.verified === true, "verify_report recomputes a sealed report's hash", String(verified.structuredContent?.content_hash).slice(0, 16));

  const unknownTool = await client.callTool({ name: "start_run", arguments: {} }).then(() => "answered", (e) => String(e.message ?? e));
  report(/Unknown tool|-32602/.test(unknownTool), "a read key is offered no tool that starts anything", unknownTool.slice(0, 60));
  await client.close();

  // The run and write scopes.
  const connect = async (scopes: string[]) => {
    const k = mintKey();
    const { data: row } = await db.from("api_keys").insert({ workspace_id: a.ws, name: `mcp-${scopes.join("-")}`, prefix: k.prefix, key_hash: k.hash, scopes, created_by: a.user.id }).select("id").single();
    const c = new Client({ name: "novera-verify", version: "1.0.0" });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), { requestInit: { headers: { authorization: `Bearer ${k.key}` } } }));
    const callOn = async (name: string, args: Record<string, unknown> = {}) =>
      (await c.callTool({ name, arguments: args })) as { isError?: boolean; structuredContent?: Record<string, unknown>; content: Array<{ text: string }> };
    return { c, id: row!.id as string, call: callOn };
  };

  const { error: writeOnly } = await db.from("api_keys").insert({ workspace_id: a.ws, name: "w", prefix: "nvk_w", key_hash: "ee", scopes: ["write"], created_by: a.user.id });
  report(Boolean(writeOnly), "a key cannot write without also reading", writeOnly?.message.slice(0, 60));

  const runKey = await connect(["read", "run"]);
  const runTools = (await runKey.c.listTools()).tools;
  report(runTools.length === 9 && runTools.some((t) => t.name === "start_run") && !runTools.some((t) => t.name === "draft_scenarios"),
    "a run key is offered start_run and advance_run, and no drafting", runTools.slice(7).map((t) => t.name).join(", "));
  const foreignStart = await runKey.call("start_run", { agent_id: (await db.from("agents").select("id").eq("workspace_id", b.ws).single()).data!.id });
  report(foreignStart.isError === true, "start_run on another workspace's agent is refused", foreignStart.content[0].text.slice(0, 70));
  const foreignAdvance = await runKey.call("advance_run", { run_id: b.runs[0] });
  report(foreignAdvance.isError === true && /No such run/.test(foreignAdvance.content[0].text), "advance_run on another workspace's run is refused");
  await runKey.c.close();

  const writeKey = await connect(["read", "write"]);
  const init = writeKey.c.getInstructions() ?? "";
  const writeTools = (await writeKey.c.listTools()).tools;
  report(writeTools.length === 9 && !writeTools.some((t) => t.name === "start_run")
    && writeTools.filter((t) => ["draft_scenarios", "request_diagnosis"].includes(t.name)).every((t) => t.annotations?.readOnlyHint === false && t.annotations?.destructiveHint === false),
    "a write key is offered the two proposing tools, declared not read-only and not destructive", writeTools.slice(7).map((t) => t.name).join(", "));
  report(/nothing you call can approve/.test(init), "its instructions say approving is a person's decision");
  report(!writeTools.some((t) => /approve|reject|publish|revoke|send|decide/.test(t.name)), "no tool approves, rejects, publishes, revokes or sends");

  const passed = await writeKey.call("request_diagnosis", { run_id: a.runs[1], scenario_id: "T01" });
  report(passed.isError === true && /passed/.test(passed.content[0].text), "a passed scenario is not diagnosed", passed.content[0].text.slice(0, 60));
  const noResult = await writeKey.call("request_diagnosis", { run_id: a.runs[0], scenario_id: "T02" });
  report(noResult.isError === true && /no verdict/.test(noResult.content[0].text), "a scenario with no result is not diagnosed — there is no failure to explain", noResult.content[0].text.slice(0, 60));
  const foreignDiag = await writeKey.call("request_diagnosis", { run_id: b.runs[0], scenario_id: "T01" });
  report(foreignDiag.isError === true && /No such scenario/.test(foreignDiag.content[0].text), "another workspace's scenario is refused before any model call");
  const foreignDraft = await writeKey.call("draft_scenarios", { agent_id: (await db.from("agents").select("id").eq("workspace_id", b.ws).single()).data!.id });
  report(foreignDraft.isError === true && /could not be found/.test(foreignDraft.content[0].text), "drafting from another workspace's agent is refused");
  const tooMany = await writeKey.call("draft_scenarios", { agent_id: (await db.from("agents").select("id").eq("workspace_id", a.ws).single()).data!.id, count: 40 });
  report(tooMany.isError === true && /1 to 6/.test(tooMany.content[0].text), "an out-of-range count is refused before any model call");

  // Who asked is recorded once, and only in the key's own workspace.
  const { data: aAgent } = await db.from("agents").select("id").eq("workspace_id", a.ws).single();
  const { data: aPolicy } = await db.from("policies").select("id").eq("workspace_id", a.ws).single();
  const draftRow = { agent_id: aAgent!.id, policy_id: aPolicy!.id, source_quote: "policy a", scenario: { id: "D01", input: "x" }, created_by: a.user.id, api_key_id: writeKey.id };
  const { data: draft, error: draftErr } = await db.from("scenario_drafts").insert({ workspace_id: a.ws, ...draftRow }).select("id").single();
  report(!draftErr, "a draft can name the key that asked for it", draftErr?.message);
  const { error: rewrite } = await db.from("scenario_drafts").update({ api_key_id: null }).eq("id", draft?.id ?? "");
  report(Boolean(rewrite) && /recorded once/.test(rewrite!.message), "who asked for a draft cannot be rewritten", rewrite?.message.slice(0, 60));
  const { data: bAgent } = await db.from("agents").select("id").eq("workspace_id", b.ws).single();
  const { data: bPolicy } = await db.from("policies").select("id").eq("workspace_id", b.ws).single();
  const { error: crossKey } = await db.from("scenario_drafts").insert({ workspace_id: b.ws, ...draftRow, agent_id: bAgent!.id, policy_id: bPolicy!.id, created_by: b.user.id });
  report(Boolean(crossKey), "a draft cannot name another workspace's key", crossKey?.message.slice(0, 60));

  if (process.env.VERIFY_MCP_MODEL === "1") {
    await db.from("policies").insert({ workspace_id: a.ws, agent_id: aAgent!.id, version: 2, body: [
      "## Refunds",
      "Refunds are available within 30 days of purchase with a receipt.",
      "Never promise a refund outside that window; offer to escalate to a human instead.",
      "## Personal data",
      "Never read back a customer's full card number, password or security answer.",
      "## Honesty",
      "If you do not know the answer, say so and offer a human agent.",
    ].join("\n") });
    const drafted = await writeKey.call("draft_scenarios", { agent_id: aAgent!.id, count: 3 });
    const d = drafted.structuredContent as { status?: string; drafts?: Array<{ draft_id: string }>; review_url?: string } | undefined;
    const { data: stored } = d?.drafts?.[0] ? await db.from("scenario_drafts").select("status, api_key_id, created_by").eq("id", d.drafts[0].draft_id).single() : { data: null };
    report(d?.status === "draft" && stored?.status === "draft" && stored.api_key_id === writeKey.id && stored.created_by === a.user.id,
      "draft_scenarios stores a draft naming the key and its creator", drafted.isError ? drafted.content[0].text : `${d?.drafts?.length} draft(s), ${d?.review_url}`);
    const diagnosed = await writeKey.call("request_diagnosis", { run_id: a.runs[0], scenario_id: "T01" });
    const p = diagnosed.structuredContent as { status?: string; diagnosis_id?: string } | undefined;
    const { data: prop } = p?.diagnosis_id ? await db.from("diagnoses").select("status, api_key_id, requested_by").eq("id", p.diagnosis_id).single() : { data: null };
    report(p?.status === "proposed" && prop?.status === "proposed" && prop.api_key_id === writeKey.id && prop.requested_by === a.user.id,
      "request_diagnosis stores a proposal naming the key and its creator", diagnosed.isError ? diagnosed.content[0].text : String(p?.diagnosis_id));
  }
  await writeKey.c.close();

  // Transport rules, over raw HTTP.
  const post = (headers: Record<string, string>) => fetch(`${base}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${minted.key}`, ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });
  report((await post({ origin: "https://evil.example" })).status === 403, "a request from another web origin is refused (DNS-rebinding guard)");
  report((await post({ "mcp-protocol-version": "1999-01-01" })).status === 400, "an unsupported protocol version is refused with 400");
  report((await post({})).status === 200, "a request with no Origin, as non-browser clients send, is served");
  report((await fetch(`${base}/api/mcp`, { headers: { authorization: `Bearer ${minted.key}` } })).status === 405, "GET is 405: no server stream is offered");
  const noKey = await fetch(`${base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  report(noKey.status === 401 && (noKey.headers.get("content-type") ?? "").includes("json"), "no key: a JSON 401");
  const notification = await fetch(`${base}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${minted.key}` },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  report(notification.status === 202 && (await notification.text()) === "", "a notification is 202 with no body");
} finally {
  await db.rpc("erase_workspace", { target: a.ws });
  await db.rpc("erase_workspace", { target: b.ws });
  await db.auth.admin.deleteUser(a.user.id);
  await db.auth.admin.deleteUser(b.user.id);
  console.log("  removed the verification workspaces and users");
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
