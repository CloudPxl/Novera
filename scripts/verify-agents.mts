/**
 * Every preset's wire format and the ways a platform fails, over real HTTP, through the real
 * adapter and the real runner.
 *
 * A local server on loopback emulates each platform (Dify chatflow and workflow, chat
 * completions, JSON lines, a whole-text stream) and each failure (a rate window, a missing
 * input variable, a sign-in page, a flow branch with no answer step). The suite is the first
 * single-message scenarios of eu-support v7; grading is a stub that passes whatever arrives, so
 * no model is called and nothing touches a database. What is measured is what reaches the
 * record: every scenario recorded once, the right cause for each no-result, the platform's own
 * words quoted, a limit waited out one at a time, and a broken connection found before the
 * first scenario.
 *
 * Free, no network beyond loopback, about a minute. Run: npm run verify:agents
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { httpAgent } from "../src/lib/agents/http.ts";
import { presetByKey } from "../src/lib/agents/presets.ts";
import { executeRun } from "../src/lib/runner/execute.ts";
import { repairFor } from "../src/lib/evidence/repair.ts";
import type { HttpAgentConfig } from "../src/lib/agents/types.ts";
import type { RunCaseRecord, RunStore, Suite, SuiteCase } from "../src/lib/runner/types.ts";
import type { RoutedChat } from "../src/lib/router/execute.ts";

let failures = 0;
function report(ok: boolean, label: string, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const v7 = JSON.parse(readFileSync("data/suites/eu-support-v7.json", "utf8")) as { cases: SuiteCase[] };
const cases = v7.cases.filter((c) => !c.earlier_turns && !c.persona && !c.context && !c.destructive && !c.fixture_only).slice(0, 8);
const suite: Suite = { key: "verify-agents", version: 1, name: "verify agents", cases };

// ---------------------------------------------------------------- the emulated platforms

const sse = (res: ServerResponse, events: unknown[]) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
  res.end();
};
const json = (res: ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
async function bodyOf(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
const textOf = (b: Record<string, unknown>) => String(b.query ?? (b.inputs as Record<string, unknown> | undefined)?.query ?? b.message ?? JSON.stringify(b.messages ?? ""));

// A rate window: at most `WINDOW_MAX` requests in any `WINDOW_MS`, as a sandbox plan allows.
const WINDOW_MS = 3_000;
const WINDOW_MAX = 3;
const windowHits: number[] = [];
const concurrent = { now: 0, maxAfterLimit: 0, limited: false };
const flakySeen = new Set<string>();

const routes: Record<string, (b: Record<string, unknown>, res: ServerResponse) => void | Promise<void>> = {
  "/dify": (b, res) => sse(res, [
    { event: "workflow_started" },
    { event: "message", answer: "Thanks for asking. ", conversation_id: "c-1" },
    { event: "message", answer: `I can help with: ${textOf(b).slice(0, 40)}` },
    { event: "workflow_finished", data: { status: "succeeded", outputs: { answer: "…" } } },
    { event: "message_end" },
  ]),
  // A classifier branch with no Answer step: requests to act finish with no text.
  "/dify-branch": (b, res) => {
    const acts = /refund|cancel|delete|change|export/i.test(textOf(b));
    sse(res, acts
      ? [{ event: "workflow_started" }, { event: "node_finished", data: { title: "HTTP Request", status: "succeeded" } }, { event: "workflow_finished", data: { status: "succeeded", outputs: {} } }, { event: "message_end" }]
      : [{ event: "message", answer: "Here is what I know." }, { event: "message_end" }]);
  },
  "/dify-window": async (b, res) => {
    const now = Date.now();
    while (windowHits.length && now - windowHits[0] > WINDOW_MS) windowHits.shift();
    concurrent.now++;
    if (concurrent.limited) concurrent.maxAfterLimit = Math.max(concurrent.maxAfterLimit, concurrent.now);
    await new Promise((r) => setTimeout(r, 30));
    concurrent.now--;
    if (windowHits.length >= WINDOW_MAX) {
      concurrent.limited = true;
      return sse(res, [{ event: "error", status: 429, code: "too_many_requests", message: "Too many requests, please try again later." }]);
    }
    windowHits.push(now);
    sse(res, [{ event: "message", answer: "Answered inside the window." }, { event: "message_end" }]);
  },
  // A step's dependency failing once per message: the workflow finishes failed, no error event follows.
  "/dify-flaky": (b, res) => {
    const key = textOf(b);
    if (key !== "" && !flakySeen.has(key)) {
      flakySeen.add(key);
      return sse(res, [
        { event: "node_finished", data: { node_type: "http-request", title: "Order lookup", status: "failed", error: "Reached maximum retries (0) for URL" } },
        { event: "workflow_finished", data: { status: "failed", error: "Reached maximum retries (0) for URL" } },
      ]);
    }
    sse(res, [{ event: "message", answer: "Looked it up on the second try." }, { event: "message_end" }]);
  },
  "/dify-missing-var": (_b, res) => sse(res, [{ event: "error", status: 400, code: "invalid_param", message: "customer_tier is required in input form" }]),
  "/login": (_b, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<!doctype html><html><head><title>Sign in</title></head><body>Please sign in</body></html>"); },
  "/workflow": (b, res) => json(res, { workflow_run_id: "w-1", data: { status: "succeeded", outputs: { text: `Decision for: ${textOf(b).slice(0, 30)}` } } }),
  "/openai": (_b, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const piece of ["I ", "can ", "help."]) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  },
  "/ndjson": (_b, res) => { res.writeHead(200, { "content-type": "application/x-ndjson" }); res.end('{"reply":"One "}\n{"reply":"line at a time."}\n'); },
  "/whole": (_b, res) => sse(res, [{ reply: "The whole" }, { reply: "The whole reply" }, { reply: "The whole reply so far." }]),
};

const server = createServer(async (req, res) => {
  const route = routes[(req.url ?? "").split("?")[0]];
  const body = await bodyOf(req);
  if (!route) return json(res, { error: "no such route" }, 404);
  await route(body, res);
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

// ---------------------------------------------------------------- the run, without a database

const judge: RoutedChat = async () => ({
  text: JSON.stringify({ verdict: "pass", rationale: "stub." }), model: "stub", usage: {}, raw: {},
  servedBy: { connection: "stub", model: "stub-model" }, attempts: [{ connection: "stub", model: "stub-model", ok: true, ms: 1 }],
});

async function run(config: HttpAgentConfig) {
  const saved: RunCaseRecord[] = [];
  let probes = 0;
  let sends = 0;
  const adapter = httpAgent(config);
  const agent = { ...adapter, probe: async () => { probes++; return adapter.probe(); }, send: async (i: Parameters<typeof adapter.send>[0]) => { sends++; return adapter.send(i); } };
  const store: RunStore = { async saveCase(r) { saved.push(r); }, async markRunning() {}, async finishRun() {} };
  const started = Date.now();
  const summary = await executeRun({ runId: "verify", suite, agent, policy: "Answer from the documentation only.", judge, store, paceMs: 250, probeFirst: true, agentIsProduction: false });
  return { summary, saved, probes, sends, ms: Date.now() - started };
}

const difyBody = presetByKey("dify")!.bodyTemplate;
const dify = (path: string): HttpAgentConfig => ({ kind: "http", url: `${origin}${path}`, bodyTemplate: difyBody, responsePath: "answer", streamPath: "answer", conversationIdPath: "conversation_id" });
const plain = (path: string, extra: Partial<HttpAgentConfig> = {}): HttpAgentConfig => ({ kind: "http", url: `${origin}${path}`, bodyTemplate: { message: "{{input}}" }, responsePath: "reply", ...extra });

try {
  console.log(`\nverify:agents — ${cases.length} scenarios of eu-support v7 per platform, stub grading, loopback only\n`);

  for (const [label, config] of [
    ["Dify chatflow stream", dify("/dify")],
    ["Dify workflow, blocking", { ...plain("/workflow"), bodyTemplate: presetByKey("dify-workflow")!.bodyTemplate, responsePath: "data.outputs.text" }],
    ["chat completions stream", { ...plain("/openai"), bodyTemplate: { model: "m", messages: "{{messages}}" }, responsePath: "choices.0.message.content" }],
    ["JSON lines", plain("/ndjson")],
    ["a whole-text stream, declared", plain("/whole", { streamMode: "whole" })],
  ] as const) {
    const r = await run(config as HttpAgentConfig);
    report(r.summary.status === "completed" && r.saved.length === cases.length && r.saved.every((c) => c.status === "pass"),
      `${label}: every scenario answered and graded`, `${r.saved.filter((c) => c.status === "pass").length}/${cases.length}, ${r.probes} check message`);
  }

  {
    const r = await run(plain("/whole"));
    const repairs = r.saved.map((c) => repairFor({ status: c.status, error: c.error ?? null, replied: false, evidenceGap: null, judgeAgreement: null, judgeAttempts: [], actsOnTheWorld: false, toolCalls: 0 })?.reason);
    report(r.summary.status === "aborted" && r.sends === 0 && /whole text/.test(r.summary.error ?? ""),
      "a whole-text stream read as pieces is refused at the check, never graded doubled", `${r.summary.status}, ${r.sends} sent; ${repairs.length} recorded`);
  }

  {
    const r = await run(dify("/dify-branch"));
    const empty = r.saved.filter((c) => c.status === "error");
    const reasons = new Set(empty.map((c) => repairFor({ status: "error", error: c.error ?? null, replied: false, evidenceGap: null, judgeAgreement: null, judgeAttempts: [], actsOnTheWorld: false, toolCalls: 0 })?.label));
    report(r.summary.status === "completed" && r.saved.length === cases.length && empty.length > 0 && r.saved.some((c) => c.status === "pass"),
      "a flow branch with no answer step: those scenarios are no result, the rest graded, the run completes",
      `${empty.length} without a result (${[...reasons].join(", ")}), ${r.probes} check message(s)`);
    report([...reasons].every((l) => l === "Agent answered with nothing"), "…and each says the agent answered with nothing, owned by the agent");
  }

  {
    const r = await run(dify("/dify-flaky"));
    report(r.summary.status === "completed" && r.saved.length === cases.length && r.saved.every((c) => c.status === "pass"),
      "a workflow step failing once per message is sent once more and every scenario recovers", `${r.saved.filter((c) => c.status === "pass").length}/${cases.length}, ${r.sends} sends`);
  }

  {
    const r = await run(dify("/dify-missing-var"));
    report(r.summary.status === "aborted" && r.sends === 0 && r.saved.length === 0 && /customer_tier is required in input form/.test(r.summary.error ?? ""),
      "a missing input variable is found before the first scenario, in the platform's words, and nothing is recorded",
      (r.summary.error ?? "").slice(0, 140));
  }

  {
    const r = await run(plain("/login"));
    report(r.summary.status === "aborted" && r.sends === 0 && /web page titled "Sign in"/.test(r.summary.error ?? ""),
      "a sign-in page answering is named, before the first scenario", (r.summary.error ?? "").slice(0, 140));
  }

  {
    windowHits.length = 0;
    const r = await run(dify("/dify-window"));
    const limited = r.saved.filter((c) => /over a limit/.test(c.error ?? ""));
    report(r.summary.status === "completed" && r.saved.length === cases.length && new Set(r.saved.map((c) => c.caseId)).size === cases.length,
      `a platform allowing ${WINDOW_MAX} requests per ${WINDOW_MS / 1000} s: every scenario recorded once`, `${r.saved.filter((c) => c.status === "pass").length}/${cases.length} graded in ${Math.round(r.ms / 1000)} s; ${limited.length} gave up`);
    report(concurrent.maxAfterLimit <= 1, "…sent one at a time once the platform said it was limited", `at most ${concurrent.maxAfterLimit} in flight after the first limit`);
  }
} finally {
  await new Promise<void>((r) => server.close(() => r()));
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll agent checks passed.");
process.exit(failures ? 1 : 0);
