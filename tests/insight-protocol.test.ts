import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOT_TOKEN, CAPTURE_LIMIT_BYTES, PACING_MS, REPLY_LIMIT_BYTES, USER_AGENT,
  parseClaimRequest, parseEventRequest, parseWorkerEvent, waitBeforeNextTurn,
} from "../src/lib/insight/protocol.ts";
import { isWorkerRequest, workerSecret } from "../src/lib/insight/worker-secret.ts";
import { tickSecret } from "../src/lib/schedules/secret.ts";

const capture = { method: "dom_delta", selector_path: "iframe#chat textarea", frame_origin: "https://demo.example", typed_at: "2026-11-10T10:00:00.000Z", captured_at: "2026-11-10T10:00:04.000Z", stabilised_ms: 2500, nav_ms: 1800, partial: false };

test("claim request: a worker id of the allowed shape, optional short labels", () => {
  assert.deepEqual(parseClaimRequest({ worker_id: "vps-1" }), { worker_id: "vps-1" });
  assert.deepEqual(parseClaimRequest({ worker_id: "mac.local", host_label: "David's Mac", version: "0.1.0" }), { worker_id: "mac.local", host_label: "David's Mac", version: "0.1.0" });
  assert.ok("error" in parseClaimRequest({ worker_id: "Bad Id" }));
  assert.ok("error" in parseClaimRequest({ worker_id: "x".repeat(65) }));
  assert.ok("error" in parseClaimRequest({ worker_id: "ok", host_label: "y".repeat(101) }));
  assert.ok("error" in parseClaimRequest(null));
  assert.ok("error" in parseClaimRequest("vps-1"));
});

test("events: every kind is bounded and unknown kinds are refused", () => {
  assert.deepEqual(parseWorkerEvent({ kind: "heartbeat" }), { kind: "heartbeat" });
  const page = parseWorkerEvent({ kind: "page", final_url: "https://demo.example/", title: "Demo", widget: { vendor: "intercom", selector_path: "iframe#x textarea", frame_origin: "https://w.example" }, consent_clicked: true });
  assert.ok(!("error" in page) && page.kind === "page" && page.widget?.vendor === "intercom" && page.consent_clicked === true);
  assert.ok("error" in parseWorkerEvent({ kind: "page", title: "x" }), "final_url required");
  assert.ok("error" in parseWorkerEvent({ kind: "page", final_url: "https://demo.example/", widget: { vendor: "x" } }), "selector_path required");
  const robots = parseWorkerEvent({ kind: "robots", allowed: true, crawl_delay_ms: 15000, status: 200 });
  assert.deepEqual(robots, { kind: "robots", allowed: true, crawl_delay_ms: 15000, status: 200 });
  assert.ok("error" in parseWorkerEvent({ kind: "robots", allowed: "yes" }));
  const err = parseWorkerEvent({ kind: "error", error_kind: "blocked_login", detail: "A password field appeared." });
  assert.deepEqual(err, { kind: "error", error_kind: "blocked_login", detail: "A password field appeared." });
  assert.ok("error" in parseWorkerEvent({ kind: "error", error_kind: "lease_expired", detail: "x" }), "a server-decided kind is not the worker's to report");
  assert.ok("error" in parseWorkerEvent({ kind: "error", error_kind: "worker_error", detail: "x".repeat(501) }));
  assert.ok("error" in parseWorkerEvent({ kind: "teleport" }));
  assert.ok("error" in parseWorkerEvent(null));
});

test("turn: the reply and its capture are bounded; no reply means no captured_at", () => {
  const ok = parseWorkerEvent({ kind: "turn", scenario_id: "P01", prompt_text: "Hello", response_text: "Hi there", capture });
  assert.ok(!("error" in ok) && ok.kind === "turn" && ok.response_text === "Hi there" && ok.capture.partial === false);
  const none = parseWorkerEvent({ kind: "turn", scenario_id: "P01", prompt_text: "Hello", response_text: null, capture: { ...capture, captured_at: null } });
  assert.ok(!("error" in none) && none.kind === "turn" && none.response_text === null);
  assert.ok("error" in parseWorkerEvent({ kind: "turn", scenario_id: "P01", prompt_text: "Hello", response_text: null, capture }), "captured_at with no reply");
  assert.ok("error" in parseWorkerEvent({ kind: "turn", scenario_id: "P01", prompt_text: "Hello", response_text: "x".repeat(REPLY_LIMIT_BYTES + 1), capture }));
  assert.ok("error" in parseWorkerEvent({ kind: "turn", scenario_id: "P01", prompt_text: "Hello", response_text: "x", capture: { ...capture, selector_path: "s".repeat(CAPTURE_LIMIT_BYTES) } }));
  assert.ok("error" in parseWorkerEvent({ kind: "turn", scenario_id: "P01", prompt_text: "Hello", response_text: "x", capture: { ...capture, method: "screenshot" } }));
  assert.ok("error" in parseWorkerEvent({ kind: "turn", scenario_id: "P01", prompt_text: "Hello", response_text: "x", capture: { ...capture, partial: "no" } }));
  assert.ok("error" in parseWorkerEvent({ kind: "turn", scenario_id: "P 1", prompt_text: "Hello", response_text: "x", capture }));
  assert.ok("error" in parseWorkerEvent({ kind: "turn", scenario_id: "P01", prompt_text: "", response_text: "x", capture }));
  assert.ok("error" in parseWorkerEvent({ kind: "turn", scenario_id: "P01", prompt_text: "Hello", response_text: 5, capture }));
});

test("event request: worker id, a uuid lease token and a valid event", () => {
  const token = "123e4567-e89b-12d3-a456-426614174000";
  const ok = parseEventRequest({ worker_id: "vps-1", lease_token: token, event: { kind: "heartbeat" } });
  assert.deepEqual(ok, { worker_id: "vps-1", lease_token: token, event: { kind: "heartbeat" } });
  assert.ok("error" in parseEventRequest({ worker_id: "vps-1", lease_token: "nope", event: { kind: "heartbeat" } }));
  assert.ok("error" in parseEventRequest({ worker_id: "vps-1", lease_token: token, event: { kind: "nope" } }));
  assert.ok("error" in parseEventRequest({ lease_token: token, event: { kind: "heartbeat" } }));
});

test("the worker secret is derived, versioned, distinct from the clock's, and checked in constant time", () => {
  const a = workerSecret("key-one");
  assert.equal(a, workerSecret("key-one"));
  assert.notEqual(a, workerSecret("key-two"));
  assert.notEqual(a, tickSecret("key-one"), "a worker secret must not open the schedule clock");
  assert.equal(isWorkerRequest(`Bearer ${a}`, "key-one"), true);
  assert.equal(isWorkerRequest(`Bearer ${a}x`, "key-one"), false);
  assert.equal(isWorkerRequest(`Bearer ${a}`, "key-two"), false);
  assert.equal(isWorkerRequest(a, "key-one"), false, "a bare value is not a bearer header");
  assert.equal(isWorkerRequest(null, "key-one"), false);
  assert.equal(isWorkerRequest(`Bearer ${a}`, undefined as unknown as string), process.env.NOVERA_ENCRYPTION_KEY ? isWorkerRequest(`Bearer ${a}`) : false);
  assert.throws(() => workerSecret(""), /NOVERA_ENCRYPTION_KEY/);
});

test("pacing: the wait before the next turn, and how the worker names itself", () => {
  const now = new Date("2026-11-10T10:00:12.000Z");
  assert.equal(waitBeforeNextTurn(null, now), 0);
  assert.equal(waitBeforeNextTurn("2026-11-10T10:00:00.000Z", now), 0);
  assert.equal(waitBeforeNextTurn("2026-11-10T10:00:05.000Z", now), 5000);
  assert.equal(waitBeforeNextTurn("2026-11-10T10:00:11.000Z", now, 20_000), 19_000);
  assert.equal(PACING_MS, 12_000);
  assert.ok(USER_AGENT.startsWith(`${BOT_TOKEN}/`));
  assert.match(USER_AGENT, /\+https:\/\/www\.nover\.space\/bot/);
});
