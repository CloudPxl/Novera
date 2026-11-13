/**
 * Whose side a run's time is on, and how the next slice is asked for (2026-11-13): per-case timing
 * stored by the runner, the summary and the one-sentence holdup both run pages read, the fair claim
 * with its fallback to 0067's, and the server's own dispatch of the next slice.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentTimeOf, executeCase } from "../src/lib/runner/execute.ts";
import { bottleneck, recentCases, summariseTiming, SLOW_AGENT_MS } from "../src/lib/workflow/timing.ts";
import { advanceRun, sliceLimits } from "../src/lib/workflow/start-run.ts";
import { chainAfterSlice, dispatchSlice, dispatchToken, isDispatchRequest } from "../src/lib/workflow/dispatch.ts";
import type { RoutedChat } from "../src/lib/router/execute.ts";
import type { AgentAdapter } from "../src/lib/agents/types.ts";
import type { SuiteCase } from "../src/lib/runner/types.ts";

const testCase: SuiteCase = { id: "T1", category: "policy", obligation: "policy_accuracy", severity: "medium", input: "in", expected_behavior: "e", assertions: ["a"] };

test("a case stores its agent's reply time apart from Novera's grading time and the part of it spent waiting", async () => {
  const agent: AgentAdapter = {
    probe: async () => ({ ok: true, responseText: "hi", toolActivity: null, latencyMs: 1 }),
    send: async () => ({ ok: true, responseText: "a reply", toolActivity: null, latencyMs: 4_200 }),
    acceptsContext: () => true,
  } as unknown as AgentAdapter;
  const judge: RoutedChat = async () => {
    await new Promise((r) => setTimeout(r, 30));
    return {
      text: JSON.stringify({ verdict: "pass", rationale: "fine." }), model: "m", usage: {}, raw: {},
      servedBy: { connection: "stub", model: "m" }, attempts: [{ connection: "stub", model: "m", ok: true, ms: 10, waitedMs: 20 }],
    };
  };
  const outcome = await executeCase({ testCase, agent, policy: "p", judge });
  const timing = (outcome.usage as { timing?: { agent_ms: number; grading_ms: number; grading_wait_ms: number } }).timing;
  assert.equal(timing?.agent_ms, 4_200, "the agent's own reply time, not the wall time of the case");
  assert.ok((timing?.grading_ms ?? 0) >= 50, `two opinions of ~30 ms each: ${timing?.grading_ms}`);
  assert.equal(timing?.grading_wait_ms, 40, "both opinions waited 20 ms for a slot");
  assert.equal(agentTimeOf(900, [
    { role: "customer", content: "a" }, { role: "agent", content: "b", latencyMs: 1_000 },
    { role: "customer", content: "c", simulated: { model: "x" } } as never, { role: "agent", content: "d", latencyMs: 2_500 },
  ]), 3_500, "a conversation's agent time is its turns' sum; the simulated customer is Novera's, not the agent's");
});

test("the timing summary reads stored rows only, old rows by their agent latency, and names who is slow now", () => {
  const rows = [
    { created_at: "2026-11-13T10:00:05Z", timing: { agent_ms: 2_000, grading_ms: 3_000, grading_wait_ms: 1_000 } },
    { created_at: "2026-11-13T10:00:09Z", timing: { agent_ms: 4_000, grading_ms: 5_000, grading_wait_ms: 0 } },
    { created_at: "2026-11-13T10:00:01Z", latency_ms: 6_000, timing: null },
    { created_at: "2026-11-13T10:00:11Z", timing: { agent_ms: 1_000, grading_ms: 0, grading_wait_ms: 0 } },
    { created_at: "2026-11-13T10:00:12Z", error: "Agent returned HTTP 429: the agent's platform refused it as over a limit.", latency_ms: 0 },
  ];
  const s = summariseTiming(rows, { createdAt: "2026-11-13T09:59:00Z", startedAt: "2026-11-13T10:00:00Z" });
  assert.equal(s.queuedMs, 60_000);
  assert.equal(s.agentCases, 4);
  assert.equal(s.agentAvgMs, 3_250);
  assert.equal(s.gradedCases, 2, "a rule-settled case spent no grading time");
  assert.equal(s.gradingAvgMs, 4_000);
  assert.equal(s.gradingWaitMs, 1_000);
  assert.equal(s.agentLimited, 1);
  assert.equal(summariseTiming([], { createdAt: "2026-11-13T09:59:00Z", startedAt: null }).queuedMs, null, "not started: no queue time yet");
  assert.deepEqual(recentCases(rows, 2).map((r) => r.created_at), ["2026-11-13T10:00:12Z", "2026-11-13T10:00:11Z"]);

  const calm = summariseTiming([{ timing: { agent_ms: 1_200, grading_ms: 2_000, grading_wait_ms: 0 } }], {});
  assert.equal(bottleneck(calm, { queue: { reason: "slots", position: 3 } }).kind, "queued_slots");
  assert.match(bottleneck(calm, { queue: { reason: "slots", position: 3 } }).sentence, /position 3 for one of Novera's grading slots/);
  assert.match(bottleneck(calm, { queue: { reason: "agent", position: 2 } }).sentence, /other runs are testing this agent right now.*number 2 in line/);
  assert.match(bottleneck(calm, { queue: { reason: "agent", position: 1 } }).sentence, /This run is next in line/);
  assert.equal(bottleneck(s, {}).kind, "agent_limited");
  assert.equal(bottleneck(s, {}).side, "agent");
  const slow = summariseTiming([{ timing: { agent_ms: SLOW_AGENT_MS + 2_000, grading_ms: 2_000, grading_wait_ms: 0 } }], {});
  assert.equal(bottleneck(slow, {}).kind, "agent_slow");
  assert.match(bottleneck(slow, {}).sentence, /your agent, at 5\.0 s a reply/);
  assert.equal(bottleneck(calm, { regrading: 2 }).kind, "grading_wait");
  assert.equal(bottleneck(calm, { regrading: 2 }).side, "novera");
  const waited = summariseTiming([{ timing: { agent_ms: 1_000, grading_ms: 10_000, grading_wait_ms: 6_000 } }], {});
  assert.equal(bottleneck(waited, {}).kind, "grading_wait", "most of the grading time was waiting for a rate limit");
  assert.equal(bottleneck(calm, {}).kind, "normal");
  assert.match(bottleneck(calm, {}).sentence, /your agent 1\.2 s a reply, Novera's grading 2\.0 s a scenario/);
  assert.equal(bottleneck(summariseTiming([], {}), {}).kind, "starting");
});

test("slots and the per-agent cap come from the environment within bounds", () => {
  assert.deepEqual(sliceLimits({}), { slots: 4, perAgent: 2 });
  assert.deepEqual(sliceLimits({}, false), { slots: 2, perAgent: 2 }, "0067's claim keeps its measured two slots");
  assert.deepEqual(sliceLimits({ NOVERA_GRADING_SLOTS: "12", NOVERA_SLICES_PER_AGENT: "1" }), { slots: 12, perAgent: 1 });
  assert.deepEqual(sliceLimits({ NOVERA_GRADING_SLOTS: "0", NOVERA_SLICES_PER_AGENT: "9" }), { slots: 4, perAgent: 2 });
  assert.deepEqual(sliceLimits({ NOVERA_GRADING_SLOTS: "3.5" }), { slots: 4, perAgent: 2 });
});

/** A client that answers the run lookups and records the claim functions it was asked. */
function fakeClient(answers: Record<string, { data: unknown; error: unknown }>) {
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "update", "order", "limit"]) chain[m] = () => chain;
  chain.maybeSingle = async () => ({ data: { id: "r", status: "running" }, error: null });
  return {
    rpcs,
    client: {
      from: () => chain,
      rpc: async (name: string, args: Record<string, unknown>) => { rpcs.push({ name, args }); return answers[name] ?? { data: null, error: null }; },
    } as never,
  };
}

test("a run told to wait says where in the line it is; without 0087 the old claim is used, and not asked again for a while", async () => {
  const busy = fakeClient({ claim_run_slice_fair: { data: { outcome: "busy", reason: "slots", position: 2 }, error: null } });
  const waiting = await advanceRun({ client: busy.client, workspaceId: "w", runId: "r" });
  assert.deepEqual(waiting, { status: "running", started: false, done: false, waiting: "grading_capacity", queue: { reason: "slots", position: 2 } });
  assert.deepEqual(busy.rpcs.map((r) => r.name), ["claim_run_slice_fair"]);
  assert.equal(busy.rpcs[0].args.shared_slots, 4);
  assert.equal(busy.rpcs[0].args.per_agent, 2);

  const old = fakeClient({
    claim_run_slice_fair: { data: null, error: { code: "PGRST202", message: "Could not find the function public.claim_run_slice_fair" } },
    claim_run_slice_fenced: { data: { outcome: "busy" }, error: null },
  });
  const fallback = await advanceRun({ client: old.client, workspaceId: "w", runId: "r" });
  assert.deepEqual(fallback, { status: "running", started: false, done: false, waiting: "grading_capacity" });
  assert.deepEqual(old.rpcs.map((r) => r.name), ["claim_run_slice_fair", "claim_run_slice_fenced"]);
  assert.equal(old.rpcs[1].args.trial_slots, 2);
  await advanceRun({ client: old.client, workspaceId: "w", runId: "r" });
  assert.deepEqual(old.rpcs.map((r) => r.name).slice(2), ["claim_run_slice_fenced"], "the missing function is not asked again at once");
});

test("a dispatch token opens one run only, and a finished slice asks for its next slice and the head of the line", async () => {
  const raw = "test-encryption-key";
  const token = dispatchToken("run-a", raw);
  assert.ok(token && token.length > 30);
  assert.equal(isDispatchRequest(`Bearer ${token}`, "run-a", raw), true);
  assert.equal(isDispatchRequest(`Bearer ${token}`, "run-b", raw), false, "bound to its run");
  assert.equal(isDispatchRequest(`Bearer ${token}x`, "run-a", raw), false);
  assert.equal(isDispatchRequest(null, "run-a", raw), false);
  assert.equal(dispatchToken("run-a", ""), null, "no key, no token");

  const asked: string[] = [];
  const dispatch = async (_origin: string, id: string) => { asked.push(id); return true; };
  const line = (head: string | null, fails = false) => ({
    rpc: async () => { if (fails) throw new Error("no function"); return { data: head ? [{ run_id: head, workspace_id: "w" }] : [], error: null }; },
  }) as never;
  const started = { status: "running", started: true, done: false };
  assert.deepEqual(await chainAfterSlice({ client: line("run-b"), origin: "https://x", runId: "run-a", result: started, dispatch }), ["run-a", "run-b"]);
  asked.length = 0;
  assert.deepEqual(await chainAfterSlice({ client: line("run-b"), origin: "https://x", runId: "run-a", result: { ...started, done: true }, dispatch }), ["run-b"], "a finished run frees its slot for the head");
  assert.deepEqual(await chainAfterSlice({ client: line("run-a"), origin: "https://x", runId: "run-a", result: started, dispatch }), ["run-a"], "never asked for twice");
  assert.deepEqual(await chainAfterSlice({ client: line("run-b"), origin: "https://x", runId: "run-a", result: { status: "running", started: false, done: false }, dispatch }), [], "a slice that did not start asks for nothing: no loop");
  assert.deepEqual(await chainAfterSlice({ client: line(null, true), origin: "https://x", runId: "run-a", result: started, dispatch }), ["run-a"], "without 0087 the run still continues");

  const previous = process.env.NOVERA_ENCRYPTION_KEY;
  process.env.NOVERA_ENCRYPTION_KEY = raw;
  try {
    const seen: Array<{ url: string; auth: string | null }> = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push({ url, auth: new Headers(init.headers).get("authorization") });
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    assert.equal(await dispatchSlice("https://www.nover.space", "run-a", fetcher), true);
    assert.deepEqual(seen, [{ url: "https://www.nover.space/api/runs/run-a/continue", auth: `Bearer ${dispatchToken("run-a", raw)}` }]);
    assert.equal(await dispatchSlice("javascript:alert(1)", "run-a", fetcher), false, "only an http(s) origin");
    assert.equal(await dispatchSlice("https://x", "run-a", (async () => { throw new Error("down"); }) as unknown as typeof fetch), false);
  } finally {
    if (previous === undefined) delete process.env.NOVERA_ENCRYPTION_KEY; else process.env.NOVERA_ENCRYPTION_KEY = previous;
  }
});
