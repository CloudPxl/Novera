import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gradeCase, couldAnswerLater } from "../src/lib/judge/consensus.ts";
import { executeRun, MAX_GRADING_ATTEMPTS } from "../src/lib/runner/execute.ts";
import type { RoutedAttempt, RoutedChat } from "../src/lib/router/execute.ts";
import type { Candidate } from "../src/lib/router/routes.ts";
import type { HeldCase, RunCaseRecord, RunStore, Suite } from "../src/lib/runner/types.ts";
import type { AgentAdapter } from "../src/lib/agents/types.ts";

// Grading holds (0084): a no-result Novera caused is finished later, never recorded as one while
// a model not yet heard from could still answer — and never by asking a model twice or settling a
// tie within one side's vendor.

type Say = "pass" | "fail" | "garbage" | "limited" | "slow" | "refused";
const ROSTER: Candidate[] = [
  { connection: "gemini", model: "g" },
  { connection: "groq", model: "q" },
  { connection: "mistral", model: "m" },
];

/**
 * A router over three vendors, like production's: each model says what the script says for the
 * nth time it is called (the last entry repeats), and failures carry the reason the real router
 * records, so `couldAnswerLater` reads them as it would in production.
 */
function router(script: Record<string, Say[]>, calls: string[] = []): RoutedChat {
  const seen: Record<string, number> = {};
  return async (_task, _request, options) => {
    const attempts: RoutedAttempt[] = [];
    for (const c of ROSTER) {
      if (options?.exclude?.some((e) => e.connection === c.connection && e.model === c.model)) continue;
      if (options?.excludeConnections?.includes(c.connection)) continue;
      const n = seen[c.model] ?? 0;
      const say = script[c.model][Math.min(n, script[c.model].length - 1)];
      if (say === "limited" || say === "slow" || say === "refused") {
        seen[c.model] = n + 1;
        attempts.push({
          connection: c.connection, model: c.model, ok: false, ms: 1,
          reason: say === "limited" ? "rate_limited" : say === "slow" ? "timed_out" : "unauthorized",
        });
        continue;
      }
      seen[c.model] = n + 1;
      calls.push(c.model);
      attempts.push({ connection: c.connection, model: c.model, ok: true, ms: 1 });
      return {
        text: say === "garbage" ? "no idea" : JSON.stringify({ verdict: say, rationale: `${c.model} read it`, failed_assertions: [] }),
        model: c.model, usage: {}, raw: null, servedBy: c, attempts,
      };
    }
    throw Object.assign(new Error("every candidate failed"), { attempts });
  };
}

const CASE = {
  testCase: { caseId: "T08", input: "i", expectedBehavior: "e", assertions: ["a"] },
  agentResponse: "the reply",
  severity: "medium",
};

test("a tie whose only third vendor is rate-limited is unresolved now, and pending with both opinions", async () => {
  const out = await gradeCase({ chat: router({ g: ["fail"], q: ["pass"], m: ["limited"] }), ...CASE });
  assert.equal(out.status, "error");
  assert.equal(out.agreement, "unresolved");
  assert.ok(out.pending, "a model not heard from could still settle it");
  assert.deepEqual(out.pending.opinions.map((o) => o.status), ["fail", "pass"]);
  assert.deepEqual(out.pending.asked.map((c) => c.model).sort(), ["g", "q"]);
});

test("resumed, the tie is settled by the third vendor and neither side is asked again", async () => {
  const first = await gradeCase({ chat: router({ g: ["fail"], q: ["pass"], m: ["limited"] }), ...CASE });
  const calls: string[] = [];
  const out = await gradeCase({ chat: router({ g: ["pass"], q: ["fail"], m: ["fail"] }, calls), ...CASE, resume: first.pending });
  assert.equal(out.status, "fail");
  assert.equal(out.agreement, "majority");
  assert.deepEqual(calls, ["m"], "only the model not yet heard from was asked");
  assert.deepEqual(out.votes.map((v) => `${v.model}:${v.status}`), ["gemini/g:fail", "groq/q:pass", "mistral/m:fail"]);
  assert.ok(out.attempts.some((a) => a.reason === "rate_limited"), "the earlier rate limit stays in the provenance");
  assert.equal(out.pending, undefined);
});

test("a tie is never settled within one side's vendor, held or not", async () => {
  // Mistral answers garbage: it was heard from, so nobody is left who could settle it.
  const out = await gradeCase({ chat: router({ g: ["fail"], q: ["pass"], m: ["garbage"] }), ...CASE });
  assert.equal(out.agreement, "unresolved");
  assert.equal(out.pending, undefined, "nothing left to wait for: an unreadable answer is not asked again");
});

test("a second opinion that could not be reached leaves an unconfirmed verdict, pending; resumed it is corroborated", async () => {
  const first = await gradeCase({ chat: router({ g: ["pass"], q: ["slow"], m: ["limited"] }), ...CASE });
  assert.equal(first.status, "pass");
  assert.equal(first.agreement, "unconfirmed");
  assert.ok(first.pending);
  const calls: string[] = [];
  const out = await gradeCase({ chat: router({ g: ["fail"], q: ["pass"], m: ["pass"] }, calls), ...CASE, resume: first.pending });
  assert.equal(out.agreement, "agreed");
  assert.equal(out.status, "pass");
  assert.deepEqual(calls, ["q"], "the first model's opinion stands; it is not asked again");
});

test("no model heard from at all: pending with no opinion, and the resumption starts at the top of the route", async () => {
  const first = await gradeCase({ chat: router({ g: ["slow"], q: ["limited"], m: ["limited"] }), ...CASE });
  assert.equal(first.status, "error");
  assert.equal(first.agreement, null);
  assert.deepEqual(first.pending?.opinions, []);
  const out = await gradeCase({ chat: router({ g: ["pass"], q: ["pass"], m: ["pass"] }), ...CASE, resume: first.pending });
  assert.equal(out.agreement, "agreed");
});

test("a key the vendor refused is not capacity: nothing is pending", async () => {
  const out = await gradeCase({ chat: router({ g: ["fail"], q: ["pass"], m: ["refused"] }), ...CASE });
  assert.equal(out.agreement, "unresolved");
  assert.equal(out.pending, undefined);
  assert.equal(couldAnswerLater({ attempts: [{ connection: "x", model: "y", ok: false, ms: 1, reason: "budget_spent" }] }, []), false);
  assert.equal(couldAnswerLater({ attempts: [{ connection: "x", model: "y", ok: false, ms: 1, reason: "paced" }] }, []), true);
  assert.equal(couldAnswerLater({ attempts: [{ connection: "x", model: "y", ok: false, ms: 1, reason: "paced" }] }, [{ connection: "x", model: "y" }]), false,
    "a model that already answered is not one that could answer later");
});

test("a model that answered unreadably is excluded from the resumption", async () => {
  const first = await gradeCase({ chat: router({ g: ["garbage"], q: ["limited"], m: ["limited"] }), ...CASE });
  assert.ok(first.pending);
  const calls: string[] = [];
  await gradeCase({ chat: router({ g: ["pass"], q: ["pass"], m: ["pass"] }, calls), ...CASE, resume: first.pending });
  assert.ok(!calls.includes("g"), "the unreadable model is not paid twice");
});

// ── The runner ─────────────────────────────────────────────────────────────────────────────

const suite: Suite = {
  key: "t", version: 1, name: "t",
  cases: [
    { id: "C1", category: "policy", obligation: "policy_accuracy", severity: "medium", input: "in1", expected_behavior: "e", assertions: ["a"] },
    { id: "C2", category: "policy", obligation: "policy_accuracy", severity: "medium", input: "in2", expected_behavior: "e", assertions: ["a"] },
  ],
};

function store() {
  const saved: RunCaseRecord[] = [];
  const holds = new Map<string, HeldCase>();
  const events: string[] = [];
  const s: RunStore = {
    async saveCase(r) { saved.push(r); return "saved"; },
    async markRunning() {},
    async finishRun(_id, o) { events.push(`finished:${o.status}`); return true; },
    async holdCase(_run, held) { holds.set(held.caseId, structuredClone(held)); events.push(`held:${held.caseId}:${held.attempts}`); return "held"; },
    async releaseHold(_run, caseId) { holds.delete(caseId); events.push(`released:${caseId}`); },
  };
  return { s, saved, holds, events };
}

function agent(sent: string[]): AgentAdapter {
  return {
    probe: async () => ({ ok: true, responseText: "p", toolActivity: null, latencyMs: 1 }),
    send: async ({ input }) => { sent.push(input); return { ok: true, responseText: `reply to ${input}`, toolActivity: null, latencyMs: 1 }; },
    acceptsContext: () => true,
  };
}

/** C1's tie can be settled only once Mistral's limit clears, on its nth call. */
function capacityRouter(mistralLimitedFor: number): RoutedChat {
  let mistral = 0;
  return async (_task, request, options) => {
    const c1 = request.messages[0].content.includes("reply to in1");
    const attempts: RoutedAttempt[] = [];
    for (const c of ROSTER) {
      if (options?.exclude?.some((e) => e.connection === c.connection && e.model === c.model)) continue;
      if (options?.excludeConnections?.includes(c.connection)) continue;
      if (c.model === "m" && c1 && mistral++ < mistralLimitedFor) {
        attempts.push({ connection: c.connection, model: c.model, ok: false, ms: 1, reason: "rate_limited" });
        continue;
      }
      const verdict = c1 ? (c.model === "q" ? "pass" : "fail") : "pass";
      attempts.push({ connection: c.connection, model: c.model, ok: true, ms: 1 });
      return { text: JSON.stringify({ verdict, rationale: "r", failed_assertions: [] }), model: c.model, usage: {}, raw: null, servedBy: c, attempts };
    }
    throw Object.assign(new Error("every candidate failed"), { attempts });
  };
}

test("a run holds a capacity-only no-result, resumes it, and completes with a verdict — the agent asked once", async () => {
  const { s, saved, holds, events } = store();
  const sent: string[] = [];
  const summary = await executeRun({ runId: "r", suite, agent: agent(sent), policy: "p", judge: capacityRouter(1), store: s, concurrency: 1, holdGapMs: 5 });
  assert.equal(summary.status, "completed");
  assert.deepEqual(sent, ["in1", "in2"], "each scenario reached the agent once");
  const c1 = saved.find((r) => r.caseId === "C1");
  assert.equal(c1?.status, "fail");
  assert.equal(c1?.judgeAgreement, "majority");
  assert.equal(saved.filter((r) => r.caseId === "C1").length, 1);
  assert.equal(holds.size, 0);
  assert.deepEqual(events.filter((e) => !e.startsWith("finished")), ["held:C1:1", "released:C1"]);
  assert.ok(!("gradingPending" in (c1 as object)), "the pending state never reaches the stored row");
});

test("after the last attempt the case is recorded as the no-result it is — never guessed", async () => {
  const { s, saved, events } = store();
  const sent: string[] = [];
  const summary = await executeRun({ runId: "r", suite, agent: agent(sent), policy: "p", judge: capacityRouter(99), store: s, concurrency: 1, holdGapMs: 1 });
  assert.equal(summary.status, "completed");
  assert.deepEqual(sent, ["in1", "in2"]);
  const c1 = saved.find((r) => r.caseId === "C1");
  assert.equal(c1?.status, "error");
  assert.equal(c1?.judgeAgreement, "unresolved");
  assert.equal(events.filter((e) => e.startsWith("held:C1")).length, MAX_GRADING_ATTEMPTS - 1);
});

test("a slice that ends with a hold open leaves the run incomplete; the next slice resumes it without sending", async () => {
  const one = store();
  const sent: string[] = [];
  const deadline = Date.now() + 60_000;
  const first = await executeRun({ runId: "r", suite, agent: agent(sent), policy: "p", judge: capacityRouter(1), store: one.s, concurrency: 1, holdGapMs: 120_000, deadline });
  assert.equal(first.status, "incomplete", "never completed while a declared scenario is only held");
  assert.ok(!one.events.some((e) => e.startsWith("finished")));
  assert.equal(one.holds.size, 1);

  const two = store();
  const held = [...one.holds.values()].map((h) => ({ ...h, notBefore: Date.now() - 1 }));
  const second = await executeRun({
    runId: "r", suite, agent: agent(sent), policy: "p", judge: capacityRouter(0), store: two.s, concurrency: 1,
    skipCaseIds: one.saved.map((r) => r.caseId), held, deadline: Date.now() + 60_000,
  });
  assert.equal(second.status, "completed");
  assert.deepEqual(sent, ["in1", "in2"], "the held scenario was not sent again");
  assert.equal(two.saved.find((r) => r.caseId === "C1")?.judgeAgreement, "majority");
  assert.deepEqual(two.events, ["released:C1", "finished:completed"]);
});

test("a store that cannot hold records the case at once, as before", async () => {
  const { s, saved } = store();
  delete s.holdCase;
  const summary = await executeRun({ runId: "r", suite, agent: agent([]), policy: "p", judge: capacityRouter(99), store: s, concurrency: 1 });
  assert.equal(summary.status, "completed");
  assert.equal(saved.find((r) => r.caseId === "C1")?.judgeAgreement, "unresolved");
});

test("0084: holds are the server's, die with their run, belong to it and are no evidence", () => {
  const sql = readFileSync(new URL("../supabase/migrations/0084_grading_holds.sql", import.meta.url), "utf8");
  assert.match(sql, /run_id\s+uuid not null references runs \(id\) on delete cascade/);
  assert.match(sql, /workspace_id\s+uuid not null references workspaces \(id\) on delete cascade/);
  assert.match(sql, /primary key \(run_id, case_id\)/);
  assert.match(sql, /alter table run_case_holds enable row level security;/);
  assert.match(sql, /revoke all on table run_case_holds from public, anon, authenticated;/);
  assert.doesNotMatch(sql, /create policy/i, "no member reads a hold");
  assert.match(sql, /refuse_cross_workspace\('run_id', 'runs'\)/);
  assert.match(sql, /not declared \? new\.case_id/);
  assert.match(sql, /from run_cases where run_id = new\.run_id and case_id = new\.case_id/);
  assert.match(sql, /when \(new\.status not in \('queued', 'running'\)/);
  assert.match(sql, /delete from run_case_holds where run_id = new\.id/);
});

test("a database without 0084 answers `unavailable`, and the case is recorded at once", async () => {
  const { s, saved } = store();
  s.holdCase = async () => "unavailable";
  const summary = await executeRun({ runId: "r", suite, agent: agent([]), policy: "p", judge: capacityRouter(99), store: s, concurrency: 1 });
  assert.equal(summary.status, "completed");
  assert.equal(saved.find((r) => r.caseId === "C1")?.judgeAgreement, "unresolved");
});
