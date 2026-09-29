/**
 * Proves outbound webhooks end to end, against the running app and a receiver of our own.
 *
 * A local HTTP server plays the customer's endpoint and fails the first delivery. A real
 * run — two scenarios settled by rules alone, so no model is called — finishes through
 * the public API; the run is announced once, the failed delivery is retried and arrives,
 * and the signature checks out under the secret. Then what must never happen: the body
 * carrying the agent's reply or the policy, a second announcement of the same run, a
 * delivery to a private address, an edit to what was sent, a member reading the sealed
 * secret. The workspace and its user are erased at the end.
 *
 * Needs `npm run dev` (development allows the loopback receiver). Free.
 * Run: npm run verify:webhooks
 */
import { createServer, type IncomingMessage } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { mintKey } from "../src/lib/api/keys.ts";
import { createEndpoint, deliverDue, enqueue } from "../src/lib/webhooks/deliver.ts";
import { verifySignature } from "../src/lib/webhooks/sign.ts";

const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const POLICY = "SECRET-POLICY-TEXT: verify identity before any account change.";

let failures = 0;
function report(ok: boolean, label: string, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// The customer's endpoint: records what arrives, and fails the first request.
const received: Array<{ headers: IncomingMessage["headers"]; body: string }> = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    received.push({ headers: req.headers, body });
    res.statusCode = received.length === 1 ? 500 : 200;
    res.end("ok");
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as { port: number }).port;

const password = crypto.randomUUID();
const email = `verify-webhooks+${Date.now()}@novera.invalid`;
const user = (await db.auth.admin.createUser({ email, password, email_confirm: true })).data.user!;
const { data: ws } = await db.from("workspaces").insert({ name: "__novera_verify_webhooks__", owner_id: user.id }).select("id").single();

try {
  await db.from("workspace_members").insert({ workspace_id: ws!.id, user_id: user.id, role: "owner" });
  const { data: agent } = await db.from("agents").insert({
    workspace_id: ws!.id, name: "fixture agent", kind: "http", is_production: false,
    config: { kind: "http", url: `${base}/api/test-agent`, bodyTemplate: { message: "{{input}}", context: "{{context}}" }, responsePath: "reply", toolActivityPath: "tool_calls" },
  }).select("id").single();
  await db.from("policies").insert({ workspace_id: ws!.id, agent_id: agent!.id, version: 1, body: POLICY });
  const { data: v5 } = await db.from("suites").select("cases").eq("key", "eu-support").eq("version", 5).is("workspace_id", null).single();
  // Both settled by rules against the fixture's scripted replies: no model is asked.
  const cases = (v5!.cases as Array<{ id: string }>).filter((c) => ["T42", "T44"].includes(c.id));
  const { data: suite } = await db.from("suites").insert({ workspace_id: ws!.id, key: "webhooks", version: 1, name: "webhooks", cases }).select("id").single();
  const k = mintKey();
  await db.from("api_keys").insert({ workspace_id: ws!.id, name: "wh", prefix: k.prefix, key_hash: k.hash, scopes: ["read", "run"], created_by: user.id });

  const { id: endpointId, secret } = await createEndpoint({
    db, workspaceId: ws!.id, url: `http://127.0.0.1:${port}/hook`, events: ["run.completed", "run.stopped"], createdBy: user.id,
  });

  // A real run, through the public API.
  const headers = { authorization: `Bearer ${k.key}`, "content-type": "application/json" };
  const started = await fetch(`${base}/api/v1/runs`, { method: "POST", headers, body: JSON.stringify({ agent_id: agent!.id, suite_id: suite!.id }) });
  const runId = ((await started.json()) as { run: { id: string } }).run.id;
  for (let done = false, i = 0; !done && i < 15; i++) {
    const b = (await (await fetch(`${base}/api/v1/runs/${runId}/execute`, { method: "POST", headers })).json()) as { done?: boolean; started?: boolean };
    done = b.done === true;
    if (!done && b.started === false) await new Promise((r) => setTimeout(r, 3000));
  }

  const { data: first } = await db.from("webhook_deliveries").select("id, status, attempts, last_status").eq("endpoint_id", endpointId).eq("event", "run.completed");
  report(first?.length === 1 && first[0].status === "pending" && first[0].attempts === 1 && first[0].last_status === 500,
    "the finished run is announced once, and a 500 leaves it waiting to retry", JSON.stringify(first?.[0] ?? null));

  // The clock's retry, brought forward.
  await db.from("webhook_deliveries").update({ next_attempt_at: new Date().toISOString() }).eq("id", first![0].id);
  const retried = await deliverDue({ db, deadline: Date.now() + 10_000 });
  const { data: after } = await db.from("webhook_deliveries").select("status, attempts, last_status").eq("id", first![0].id).single();
  report(retried.delivered >= 1 && after?.status === "delivered" && after.attempts === 2, "the retry arrives", JSON.stringify(after));

  const last = received.at(-1)!;
  report(verifySignature({ secret, body: last.body, header: last.headers["novera-signature"] as string }), "the signature checks out under the endpoint's secret");
  report(!verifySignature({ secret: "whsec_wrong", body: last.body, header: last.headers["novera-signature"] as string }), "and not under any other");
  report(last.headers["novera-event"] === "run.completed" && typeof last.headers["novera-delivery"] === "string", "event and delivery id are in the headers");

  const body = JSON.parse(last.body) as { run: { counts: Record<string, number>; outcome: string; report: { url: string } | null } };
  report(body.run.counts.failed === 2 && body.run.outcome === "fail" && Boolean(body.run.report?.url), "the body carries counts, the outcome and the report link", JSON.stringify(body.run.counts));
  const { data: replies } = await db.from("run_cases").select("response_text, input").eq("run_id", runId);
  const leaked = (replies ?? []).some((r) => last.body.includes(String(r.response_text)) || last.body.includes(String(r.input)))
    || last.body.includes("SECRET-POLICY-TEXT") || last.body.includes(secret);
  report(!leaked, "the body carries no reply, no scenario input, no policy and no secret");

  const again = await enqueue({ db, workspaceId: ws!.id, event: "run.completed", subjectId: runId, body: {} });
  report(again.length === 0, "the same run is never announced twice");

  // Stopping a run announces it as stopped.
  const again2 = await fetch(`${base}/api/v1/runs`, { method: "POST", headers, body: JSON.stringify({ agent_id: agent!.id, suite_id: suite!.id }) });
  const stopId = ((await again2.json()) as { run: { id: string } }).run.id;
  await db.from("runs").update({ status: "aborted", error: "Stopped by the verification.", finished_at: new Date().toISOString(), stopped_by: user.id }).eq("id", stopId);
  const { notifyRunFinished } = await import("../src/lib/webhooks/deliver.ts");
  await notifyRunFinished(db, ws!.id, stopId, Date.now() + 8_000);
  const stopped = received.map((r) => JSON.parse(r.body) as { event: string; run?: { id: string; outcome: string } }).find((b) => b.event === "run.stopped");
  report(stopped?.run?.id === stopId && stopped.run.outcome === "incomplete", "a stopped run is announced as stopped, and as incomplete — never a pass");

  // A private address is refused at delivery, whatever was stored.
  const { id: privateId } = await createEndpoint({ db, workspaceId: ws!.id, url: "http://10.0.0.7/hook", events: ["run.completed"], createdBy: user.id });
  const [pid] = await enqueue({ db, workspaceId: ws!.id, event: "test", subjectId: null, body: {}, onlyEndpoint: privateId });
  await deliverDue({ db, ids: [pid], deadline: Date.now() + 8_000 });
  const { data: priv } = await db.from("webhook_deliveries").select("status, last_error").eq("id", pid).single();
  report(/private or internal address/.test(String(priv?.last_error)), "a delivery to a private address is not sent", String(priv?.last_error).slice(0, 80));

  // Frozen rows.
  const { error: rewrite } = await db.from("webhook_deliveries").update({ body: { forged: true } }).eq("id", first![0].id);
  report(Boolean(rewrite), "what a delivery sent cannot be changed", rewrite?.message.slice(0, 60));
  const { error: reopen } = await db.from("webhook_deliveries").update({ status: "pending" }).eq("id", first![0].id);
  report(Boolean(reopen), "a delivered delivery stays delivered", reopen?.message.slice(0, 60));
  const { error: edit } = await db.from("webhook_endpoints").update({ url: "https://elsewhere.example/" }).eq("id", endpointId);
  report(Boolean(edit), "an endpoint cannot be edited, only revoked", edit?.message.slice(0, 60));
  const { error: del } = await db.from("webhook_endpoints").delete().eq("id", endpointId);
  report(Boolean(del), "an endpoint cannot be deleted outside erasure");

  // A member reads the endpoint, never its sealed secret.
  const member = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  await member.auth.signInWithPassword({ email, password });
  const { data: visible } = await member.from("webhook_endpoints").select("id, url, secret_prefix").eq("id", endpointId);
  const { error: sealed } = await member.from("webhook_endpoints").select("secret_ciphertext").eq("id", endpointId);
  report(visible?.length === 1 && Boolean(sealed), "a member sees the endpoint and its prefix, not the sealed secret");
} finally {
  await db.rpc("erase_workspace", { target: ws!.id });
  const { count } = await db.from("webhook_endpoints").select("id", { count: "exact", head: true }).eq("workspace_id", ws!.id);
  report((count ?? 0) === 0, "erasure removes endpoints and deliveries");
  await db.auth.admin.deleteUser(user.id);
  server.close();
  console.log("  removed the verification workspace and user");
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
