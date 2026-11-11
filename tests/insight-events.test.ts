import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeInsightDb } from "./helpers/insight-fake-db.ts";
import { handleWorkerEvent } from "../src/lib/insight/events.ts";
import { claimForWorker } from "../src/lib/insight/claim.ts";
import { PrivateAddressError } from "../src/lib/net/public-url.ts";
import { INSIGHT_SUITE, INSIGHT_SUITE_DIGEST } from "../src/lib/insight/suite.ts";
import { PACING_MS, type WorkerEvent } from "../src/lib/insight/protocol.ts";
import type { GradeResult } from "../src/lib/insight/grade.ts";
import type { InsightScanRow } from "../src/lib/insight/types.ts";

type Row = Record<string, unknown>;
const TOKEN = "123e4567-e89b-12d3-a456-426614174000";
const NOW = new Date("2026-11-10T10:00:30.000Z");
const fakeDb = (seed: Record<string, Row[]>) => fakeInsightDb(seed, { token: () => TOKEN, now: () => NOW });

const scanRow = (over: Partial<InsightScanRow> = {}): Row => ({
  id: "s1", workspace_id: "w1", target_id: "t1", suite_key: "public-insight", suite_version: 1, suite_digest: INSIGHT_SUITE_DIGEST,
  scenario_ids: ["P01", "P02", "P03"], status: "running", claimed_by: "vps-1", lease_token: TOKEN,
  lease_until: new Date(NOW.getTime() + 60_000).toISOString(), last_turn_at: null, turns_recorded: 0, robots: null, page: null,
  error_kind: null, error_detail: null, aborted_reason: null, started_by: "u1", started_by_role: "owner",
  created_at: "2026-11-10T10:00:00.000Z", finished_at: null, ...over,
});

const capture = { method: "dom_delta" as const, selector_path: "textarea", frame_origin: null, typed_at: NOW.toISOString(), captured_at: NOW.toISOString(), stabilised_ms: 2500, nav_ms: 900, partial: false };
const turn = (id: string, response: string | null, partial = false): WorkerEvent => ({
  kind: "turn", scenario_id: id, prompt_text: INSIGHT_SUITE.cases.find((c) => c.id === id)!.input, response_text: response,
  capture: { ...capture, partial, captured_at: response === null ? null : capture.captured_at },
});

const pass: GradeResult = { kind: "graded", status: "pass", rationale: "Declined.", failedAssertions: [], judgeModel: "gemini/g", judgeVotes: [{ model: "gemini/g", status: "pass", rationale: null }, { model: "groq/x", status: "pass", rationale: null }], judgeAgreement: "agreed", settledBy: "models", error: null };

function deps(over: Partial<Parameters<typeof handleWorkerEvent>[1]> = {}) {
  const chatCalls: string[] = [];
  const gradeCalls: string[] = [];
  const d = {
    now: () => NOW,
    chatFor: async ({ workspaceId }: { workspaceId: string }) => { chatCalls.push(workspaceId); return { chat: (async () => { throw new Error("unused"); }) as never, funding: "plan_managed" as const, calls: [{ task: "judge", served_by: "gemini/g", attempts: 1, fell_back: false, failures: [] }] }; },
    grade: async (args: { scenario: { id: string } }) => { gradeCalls.push(args.scenario.id); return pass; },
    ...over,
  };
  return { d, chatCalls, gradeCalls };
}

const send = (db: SupabaseClient, event: WorkerEvent, d: Parameters<typeof handleWorkerEvent>[1], token = TOKEN, workerId = "vps-1") =>
  handleWorkerEvent({ db, scanId: "s1", workerId, token, event }, d);

test("the lease is checked first: unknown scan, wrong token, wrong worker, aborted or finished scan, expired lease", async () => {
  const { d } = deps();
  const missing = fakeDb({ insight_scans: [] });
  assert.deepEqual(await send(missing.client, { kind: "heartbeat" }, d), { ok: false, status: 404, error: "No such scan.", stop: true });
  const wrong = fakeDb({ insight_scans: [scanRow()] });
  assert.equal((await send(wrong.client, { kind: "heartbeat" }, d, "223e4567-e89b-12d3-a456-426614174000")).ok, false);
  assert.equal((await send(wrong.client, { kind: "heartbeat" }, d, TOKEN, "other")).ok, false);
  const aborted = fakeDb({ insight_scans: [scanRow({ status: "aborted", aborted_reason: "x", finished_at: NOW.toISOString() })] });
  const a = await send(aborted.client, { kind: "heartbeat" }, d);
  assert.ok(!a.ok && a.status === 409 && a.stop && /aborted by an operator/.test(a.error));
  const expired = fakeDb({ insight_scans: [scanRow({ lease_until: new Date(NOW.getTime() - 1).toISOString() })] });
  const e = await send(expired.client, { kind: "heartbeat" }, d);
  assert.ok(!e.ok && e.status === 409 && e.stop && /lease_expired/.test(e.error));
});

test("heartbeat extends the lease; page and robots are recorded on the scan", async () => {
  const { d } = deps();
  const db = fakeDb({ insight_scans: [scanRow()] });
  assert.deepEqual(await send(db.client, { kind: "heartbeat" }, d), { ok: true, next: null, wait_ms: 0 });
  assert.equal(db.rpcs[0].name, "touch_insight_lease");
  await send(db.client, { kind: "page", final_url: "https://demo.example/chat", title: "Demo", widget: { vendor: "intercom", selector_path: "iframe textarea", frame_origin: "https://w.example" }, consent_clicked: true }, d);
  assert.equal((db.rows.insight_scans[0].page as Row).final_url, "https://demo.example/chat");
  await send(db.client, { kind: "robots", allowed: true, crawl_delay_ms: null, status: 404 }, d);
  assert.equal(((db.rows.insight_scans[0].robots as Row).worker as Row).status, 404);
});

test("a turn: redacted before storage, graded on the workspace's funding, recorded once, paced, and the last one grades the scan", async () => {
  const { d, chatCalls, gradeCalls } = deps();
  const db = fakeDb({ insight_scans: [scanRow()] });
  const first = await send(db.client, turn("P01", "Write to support@acme.example and we will help."), d);
  assert.deepEqual(first, { ok: true, next: "P02", wait_ms: PACING_MS });
  const stored = db.rows.insight_observations[0];
  assert.equal(stored.response_text, "Write to [EMAIL_1] and we will help.");
  assert.equal((stored.redaction as Row).policy_version, 2);
  assert.match(String((stored.redaction as Row).original_hash), /^[0-9a-f]{64}$/);
  assert.equal(stored.status, "pass");
  assert.equal(stored.settled_by, "models");
  assert.equal(stored.judge_funding, "plan_managed");
  assert.equal(stored.worker_id, "vps-1");
  assert.deepEqual(chatCalls, ["w1"]);
  assert.deepEqual(gradeCalls, ["P01"]);
  const op = db.rows.model_operations[0];
  assert.equal(op.operation, "insight_grade");
  assert.equal(op.funded_by, "plan_managed");
  assert.equal(op.outcome, "ok");
  assert.doesNotMatch(JSON.stringify(op), /support@/, "no content in the operation record");
  assert.equal(db.rows.insight_scans[0].turns_recorded, 1);
  assert.equal(db.rows.insight_scans[0].last_turn_at, NOW.toISOString());

  const early = await send(db.client, turn("P02", "No."), d);
  assert.ok(!early.ok && early.status === 429 && early.retry_after_ms === PACING_MS && early.stop === false);

  const again = await send(db.client, turn("P01", "No."), { ...d, now: () => new Date(NOW.getTime() + PACING_MS) });
  assert.ok(!again.ok && again.status === 409 && /already recorded/.test(again.error) && !again.stop);

  const later = { ...d, now: () => new Date(NOW.getTime() + PACING_MS) };
  assert.deepEqual(await send(db.client, turn("P02", "I can't share that."), later), { ok: true, next: "P03", wait_ms: PACING_MS });
  const last = await send(db.client, turn("P03", "Still no."), { ...d, now: () => new Date(NOW.getTime() + 2 * PACING_MS) });
  assert.deepEqual(last, { ok: true, next: null, wait_ms: 0 });
  assert.equal(db.rows.insight_scans[0].status, "graded");
  assert.equal(db.rpcs.at(-1)?.name, "finish_insight_scan");
  assert.equal(db.rpcs.at(-1)?.args.new_status, "graded");
});

test("no reply, a partial reply and unavailable graders are recorded as errors without a verdict, and the graders are not asked", async () => {
  const { d, chatCalls, gradeCalls } = deps();
  const db = fakeDb({ insight_scans: [scanRow()] });
  await send(db.client, turn("P01", null), d);
  let o = db.rows.insight_observations[0];
  assert.equal(o.status, "error");
  assert.equal(o.response_text, null);
  assert.equal(o.settled_by, null);
  assert.match(String(o.error), /No reply arrived/);
  assert.equal((o.redaction as Row).none, "no reply arrived");

  await send(db.client, turn("P02", "Sure, let me", true), { ...d, now: () => new Date(NOW.getTime() + PACING_MS) });
  o = db.rows.insight_observations[1];
  assert.equal(o.status, "error");
  assert.equal(o.response_text, "Sure, let me");
  assert.match(String(o.error), /had not finished/);
  assert.deepEqual(chatCalls, []);
  assert.deepEqual(gradeCalls, []);

  const unavailable = { ...d, now: () => new Date(NOW.getTime() + 2 * PACING_MS), chatFor: async () => ({ error: "This workspace has used its 60 model operations for the hour." }) };
  const r = await send(db.client, turn("P03", "No."), unavailable);
  assert.ok(r.ok);
  o = db.rows.insight_observations[2];
  assert.equal(o.status, "error");
  assert.match(String(o.error), /not available: This workspace has used its 60/);
  assert.equal(db.rows.model_operations, undefined, "no chat, no operation record");
  assert.equal(db.rows.insight_scans[0].status, "graded", "every declared scenario has an observation, verdict or not");
});

test("a prompt that differs from the scenario's input ends the scan as a worker error; an undeclared scenario is refused", async () => {
  const { d } = deps();
  const db = fakeDb({ insight_scans: [scanRow()] });
  const undeclared = await send(db.client, turn("P06", "x"), d);
  assert.ok(!undeclared.ok && undeclared.status === 422 && !undeclared.stop);
  const wrong = await send(db.client, { ...turn("P01", "x"), prompt_text: "Something else" } as WorkerEvent, d);
  assert.ok(!wrong.ok && wrong.status === 422 && wrong.stop);
  assert.equal(db.rows.insight_scans[0].status, "error");
  assert.equal(db.rows.insight_scans[0].error_kind, "worker_error");
  assert.equal(db.rows.insight_observations, undefined);
});

test("a worker's error ends the scan with its kind; a grader that throws is an error row, not a lost turn", async () => {
  const { d } = deps();
  const db = fakeDb({ insight_scans: [scanRow()] });
  assert.deepEqual(await send(db.client, { kind: "error", error_kind: "blocked_login", detail: "A password field appeared." }, d), { ok: true, next: null, wait_ms: 0 });
  assert.equal(db.rows.insight_scans[0].status, "error");
  assert.equal(db.rows.insight_scans[0].error_kind, "blocked_login");

  const db2 = fakeDb({ insight_scans: [scanRow()] });
  const r = await send(db2.client, turn("P01", "x"), { ...d, grade: async () => { throw new Error("Gemini timed out"); } });
  assert.ok(r.ok);
  assert.equal(db2.rows.insight_observations[0].status, "error");
  assert.match(String(db2.rows.insight_observations[0].error), /Gemini timed out/);
  assert.equal(db2.rows.model_operations[0].outcome, "error");
});

test("claim: the server re-checks the address and robots.txt and hands over the prompts; a disallowed site ends the scan before any page opens", async () => {
  const target = { id: "t1", workspace_id: "w1", name: "Acme Demo", demo_url: "https://demo.example/chat?x=1", category: "A", do_not_contact: false };
  const db = fakeDb({ insight_scans: [scanRow({ status: "queued", claimed_by: null, lease_token: null, lease_until: null })], insight_targets: [target], insight_workers: [] });
  const fetched: string[] = [];
  const checkAddress = async (raw: string) => new URL(raw);
  const answer = await claimForWorker({
    db: db.client, worker: { worker_id: "vps-1", host_label: "vps" }, now: () => NOW, checkAddress,
    fetchRobots: async (url) => { fetched.push(url.toString()); return { status: 200, body: "User-agent: *\nDisallow: /private\nCrawl-delay: 15" }; },
  });
  assert.deepEqual(fetched, ["https://demo.example/robots.txt"]);
  assert.ok(answer.scan);
  assert.equal(answer.scan.lease_token, TOKEN);
  assert.equal(answer.scan.pacing_ms, 15_000, "Crawl-delay raises the pacing");
  assert.deepEqual(answer.scan.scenarios.map((s) => s.id), ["P01", "P02", "P03"]);
  assert.equal(answer.scan.scenarios[0].input, INSIGHT_SUITE.cases[0].input);
  assert.equal(answer.scan.target.url, "https://demo.example/chat?x=1");
  assert.match(answer.scan.user_agent, /NoveraInsightBot/);
  assert.equal(((db.rows.insight_scans[0].robots as Row).server as Row).allowed, true);
  assert.equal(db.rows.insight_workers[0].id, "vps-1");

  const refused = fakeDb({ insight_scans: [scanRow({ status: "queued", claimed_by: null, lease_token: null, lease_until: null })], insight_targets: [target], insight_workers: [] });
  const r = await claimForWorker({ db: refused.client, worker: { worker_id: "vps-1" }, now: () => NOW, checkAddress, fetchRobots: async () => ({ status: 200, body: "User-agent: noverainsightbot\nDisallow: /" }) });
  assert.deepEqual(r, { scan: null, retry: true });
  assert.equal(refused.rows.insight_scans[0].status, "error");
  assert.equal(refused.rows.insight_scans[0].error_kind, "robots_disallowed");

  const empty = fakeDb({ insight_scans: [], insight_workers: [] });
  assert.deepEqual(await claimForWorker({ db: empty.client, worker: { worker_id: "vps-1" }, now: () => NOW, checkAddress, fetchRobots: async () => ({ status: 404, body: null }) }), { scan: null });
});

test("claim: an address the guard refuses ends the scan on the server, before robots.txt or any page", async () => {
  const target = { id: "t1", workspace_id: "w1", name: "Acme Demo", demo_url: "https://demo.example/chat", category: "A", do_not_contact: false };
  const db = fakeDb({ insight_scans: [scanRow({ status: "queued", claimed_by: null, lease_token: null, lease_until: null })], insight_targets: [target], insight_workers: [] });
  const r = await claimForWorker({
    db: db.client, worker: { worker_id: "vps-1" }, now: () => NOW,
    checkAddress: async () => { throw new PrivateAddressError("demo.example resolves to a private address and is never called."); },
    fetchRobots: async () => { throw new Error("must not fetch"); },
  });
  assert.deepEqual(r, { scan: null, retry: true });
  assert.equal(db.rows.insight_scans[0].error_kind, "address_refused");
  assert.match(String(db.rows.insight_scans[0].error_detail), /private address/);
});
