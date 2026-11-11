import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeInsightDb } from "./helpers/insight-fake-db.ts";
import { handleWorkerEvent } from "../src/lib/insight/events.ts";
import { INSIGHT_SUITE, INSIGHT_SUITE_DIGEST } from "../src/lib/insight/suite.ts";
import { parseWorkerEvent, type EventAnswer, type WorkerEvent } from "../src/lib/insight/protocol.ts";
import { INSIGHT_GRADING_ATTEMPTS, openGradingState, replyDigest, sealGradingState } from "../src/lib/insight/grading-state.ts";
import type { GradeResult } from "../src/lib/insight/grade.ts";
import type { PendingGrading } from "../src/lib/judge/consensus.ts";

// A captured insight reply whose grading stopped only for Novera's capacity is graded again
// from the same reply — never recorded as a no-result while a model could still answer, and
// never by typing the prompt to the bot again.

process.env.NOVERA_ENCRYPTION_KEY ??= "test-encryption-key-for-deferred-grading";
type Row = Record<string, unknown>;
const TOKEN = "123e4567-e89b-12d3-a456-426614174000";
const NOW = new Date("2026-11-11T10:00:30.000Z");

const scan = (): Row => ({
  id: "s1", workspace_id: "w1", target_id: "t1", suite_key: "public-insight", suite_version: 1, suite_digest: INSIGHT_SUITE_DIGEST,
  scenario_ids: ["P01", "P02"], status: "running", claimed_by: "vps-1", lease_token: TOKEN,
  lease_until: new Date(NOW.getTime() + 60_000).toISOString(), last_turn_at: null, turns_recorded: 0, robots: null, page: null,
  error_kind: null, error_detail: null, aborted_reason: null, started_by: "u1", started_by_role: "owner",
  created_at: "2026-11-11T10:00:00.000Z", finished_at: null,
});
const capture = { method: "dom_delta" as const, selector_path: "textarea", frame_origin: null, typed_at: NOW.toISOString(), captured_at: NOW.toISOString(), stabilised_ms: 2500, nav_ms: 900, partial: false };
const REPLY = "I can only help with questions about our product.";
const turn = (extra: Partial<Extract<WorkerEvent, { kind: "turn" }>> = {}): WorkerEvent => ({
  kind: "turn", scenario_id: "P01", prompt_text: INSIGHT_SUITE.cases.find((c) => c.id === "P01")!.input, response_text: REPLY, capture, ...extra,
});

const pending: PendingGrading = {
  opinions: [
    { status: "fail", rationale: "g", failedAssertions: [], usage: {}, servedBy: { connection: "gemini", model: "g" }, attempts: [], answered: [{ connection: "gemini", model: "g" }], rawJudgeText: null, error: null },
    { status: "pass", rationale: "q", failedAssertions: [], usage: {}, servedBy: { connection: "groq", model: "q" }, attempts: [], answered: [{ connection: "groq", model: "q" }], rawJudgeText: null, error: null },
  ],
  asked: [{ connection: "gemini", model: "g" }, { connection: "groq", model: "q" }],
  attempts: [{ connection: "mistral", model: "m", ok: false, ms: 1, reason: "rate_limited" }],
};
const unresolved: GradeResult = {
  kind: "graded", status: "error", rationale: null, failedAssertions: [], judgeModel: null,
  judgeVotes: [], judgeAgreement: "unresolved", settledBy: "models", error: "Two models disagreed and a third could not settle it.", pending,
};
const settled: GradeResult = { kind: "graded", status: "fail", rationale: "m", failedAssertions: [], judgeModel: "mistral/m", judgeVotes: [], judgeAgreement: "majority", settledBy: "models", error: null };

function harness(results: GradeResult[]) {
  const db = fakeInsightDb({ insight_scans: [scan()], insight_observations: [] }, { token: () => TOKEN, now: () => NOW });
  const resumes: Array<PendingGrading | undefined> = [];
  const d = {
    now: () => NOW,
    chatFor: async () => ({ chat: (async () => { throw new Error("unused"); }) as never, funding: "plan_managed" as const, calls: [] }),
    grade: async (args: { resume?: PendingGrading }) => { resumes.push(args.resume); return results[Math.min(resumes.length - 1, results.length - 1)]; },
  };
  const send = (event: WorkerEvent) => handleWorkerEvent({ db: db.client as unknown as SupabaseClient, scanId: "s1", workerId: "vps-1", token: TOKEN, event }, d);
  return { db, send, resumes };
}

const deferred = (a: EventAnswer) => (!a.ok && a.status === 503 && !a.stop ? a.grading_state : undefined);

test("a grading stopped for capacity is deferred: 503, the grading sealed, nothing recorded", async () => {
  const { db, send } = harness([unresolved]);
  const answer = await send(turn());
  const state = deferred(answer);
  assert.ok(state, "the worker is told to post the same reply again");
  assert.ok(!answer.ok && answer.retry_after_ms && answer.retry_after_ms > 0);
  assert.equal(db.rows.insight_observations.length, 0, "no observation yet: it is not a no-result");
  const opened = openGradingState(state, { scan: "s1", scenario: "P01", reply: replyDigest(REPLY) });
  assert.equal(opened?.attempt, 1);
  assert.deepEqual(opened?.pending.asked.map((c) => c.model), ["g", "q"]);
});

test("the same reply posted again resumes the grading from the sealed state, and is recorded once settled", async () => {
  const { db, send, resumes } = harness([unresolved, settled]);
  const state = deferred(await send(turn()));
  const answer = await send(turn({ grading_state: state }));
  assert.ok(answer.ok, JSON.stringify(answer));
  assert.equal(resumes[0], undefined);
  assert.deepEqual(resumes[1]?.opinions.map((o) => o.status), ["fail", "pass"], "the opinions given stand");
  assert.equal(db.rows.insight_observations.length, 1);
  assert.equal(db.rows.insight_observations[0].judge_agreement, "majority");
});

test("after the last attempt the reply is recorded as the no-result it is", async () => {
  const { db, send } = harness([unresolved]);
  let state: string | undefined;
  for (let i = 1; i < INSIGHT_GRADING_ATTEMPTS; i++) {
    state = deferred(await send(turn(state ? { grading_state: state } : {})));
    assert.ok(state, `deferred on attempt ${i}`);
  }
  const last = await send(turn({ grading_state: state }));
  assert.ok(last.ok);
  assert.equal(db.rows.insight_observations[0].status, "error");
  assert.equal(db.rows.insight_observations[0].judge_agreement, "unresolved");
});

test("a state sealed for another reply, scenario or scan, or not sealed by this server, is refused", async () => {
  const { send } = harness([unresolved, settled]);
  const forOther = sealGradingState({ scan: "s1", scenario: "P01", reply: replyDigest("another reply"), attempt: 1, pending });
  const a = await send(turn({ grading_state: forOther }));
  assert.ok(!a.ok && a.status === 422);
  const otherScan = sealGradingState({ scan: "s2", scenario: "P01", reply: replyDigest(REPLY), attempt: 1, pending });
  assert.ok(!(await send(turn({ grading_state: otherScan }))).ok);
  const forged = sealGradingState({ scan: "s1", scenario: "P01", reply: replyDigest(REPLY), attempt: 1, pending }, "the worker's guess at a key");
  const f = await send(turn({ grading_state: forged }));
  assert.ok(!f.ok && f.status === 422, "the worker cannot write a grading state");
  const good = sealGradingState({ scan: "s1", scenario: "P01", reply: replyDigest(REPLY), attempt: 1, pending });
  const [body, mac] = good.split(".");
  const tampered = `${Buffer.from(Buffer.from(body, "base64url").toString("utf8").replace('"attempt":1', '"attempt":0')).toString("base64url")}.${mac}`;
  assert.equal(openGradingState(tampered, { scan: "s1", scenario: "P01", reply: replyDigest(REPLY) }), null);
});

test("the protocol carries grading_state on a turn and refuses anything else in its place", () => {
  const good = sealGradingState({ scan: "s1", scenario: "P01", reply: replyDigest(REPLY), attempt: 1, pending });
  const ok = parseWorkerEvent({ ...turn(), grading_state: good });
  assert.ok(!("error" in ok) && ok.kind === "turn" && ok.grading_state === good);
  assert.ok("error" in parseWorkerEvent({ ...turn(), grading_state: "<script>" }));
  assert.ok("error" in parseWorkerEvent({ ...turn(), grading_state: 7 }));
  const plain = parseWorkerEvent(turn());
  assert.ok(!("error" in plain) && plain.kind === "turn" && !("grading_state" in plain));
});
