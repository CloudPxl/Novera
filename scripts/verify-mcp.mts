/**
 * Proves the MCP endpoint with the official MCP client, not only with our own tests:
 * it connects, negotiates, lists read-only tools, and every call is scoped to the key's
 * workspace. Then the transport rules over raw HTTP — Origin, GET, protocol version.
 *
 * Needs `npm run dev`. Free: no model is called.
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
  report(/Unknown tool|-32602/.test(unknownTool), "there is no tool that starts anything", unknownTool.slice(0, 60));
  await client.close();

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
