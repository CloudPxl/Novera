import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { httpVerificationConnector } from "../src/lib/evidence/connectors/http.ts";
import { applyEffectRule } from "../src/lib/judge/effect.ts";
import type { VerificationObservation } from "../src/lib/evidence/connectors/types.ts";

const config = { kind: "http_read" as const, url: "https://shop.example.com/api/" };
const expect_ = [{ type: "must_contain" as const, value: "refunded" }];

function answer(t: TestContext, body: string, status = 200) {
  const seen: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL, init: RequestInit) => {
    seen.push(String(url));
    assert.equal(init.method, "GET", "a verification must never be able to change state");
    return new Response(body, { status });
  });
  return seen;
}

test("a read-back that shows the expected state confirms it", async (t) => {
  answer(t, JSON.stringify({ invoice: "NW-4417", state: "refunded" }));
  const o = await httpVerificationConnector(config).verify({ caseId: "T22", path: "invoices/NW-4417", expect: expect_ });
  assert.equal(o.status, "confirmed");
  assert.equal(o.mode, "read_only");
  assert.match(o.detail, /contains "refunded"/, "what was looked for, not just the verdict");
});

test("a read-back that shows otherwise contradicts the agent", async (t) => {
  answer(t, JSON.stringify({ invoice: "NW-4417", state: "open" }));
  const o = await httpVerificationConnector(config).verify({ caseId: "T22", expect: expect_ });
  assert.equal(o.status, "contradicted");
  // The customer's data is never quoted back: this sentence travels into a report.
  assert.ok(!o.detail.includes("NW-4417"));
});

test("an endpoint that cannot be reached is unavailable, not a failure", async (t) => {
  answer(t, "nope", 503);
  const o = await httpVerificationConnector(config).verify({ caseId: "T22", expect: expect_ });
  assert.equal(o.status, "unavailable");
  assert.match(o.detail, /503/);
});

test("a scenario cannot point the read-back at another host", async (t) => {
  // A suite is authored data. Without this, `path` would be a way to make Novera
  // fetch anything from the customer's network.
  const seen = answer(t, "{}");
  const o = await httpVerificationConnector(config).verify({
    caseId: "T22", path: "https://elsewhere.example.com/leak", expect: expect_,
  });
  assert.equal(o.status, "unavailable");
  assert.deepEqual(seen, [], "nothing was fetched at all");
});

test("the credential goes in the configured header and never into the detail", async (t) => {
  let sent: Record<string, string> = {};
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    sent = init.headers as Record<string, string>;
    return new Response("not found", { status: 404 });
  });
  const connector = httpVerificationConnector(
    { ...config, authHeaderName: "x-api-key" },
    "sk-verify-SECRET123456",
  );
  const o = await connector.verify({ caseId: "T22", expect: expect_ });
  assert.equal(sent["x-api-key"], "sk-verify-SECRET123456");
  assert.ok(!o.detail.includes("SECRET123456"));
});

/* ------------------------------------------------------- what the rule does with it */

const observation = (status: VerificationObservation["status"]): VerificationObservation => ({
  status, detail: `read-back says ${status}`, connector: "http_read",
  connectorVersion: "1.0.0", mode: "read_only", latencyMs: 12, checked: expect_,
});

const passed = {
  effect: { describe: "invoice NW-4417 is refunded", evidence: "state_confirmed" as const },
  status: "pass" as const,
  rationale: "The agent confirmed the refund.",
  error: null,
  toolActivity: [{ tool: "issue_refund" }],
};

test("a confirmed read-back is the only way a claimed action becomes a pass", () => {
  const ruling = applyEffectRule({ ...passed, observation: observation("confirmed") });
  assert.equal(ruling.status, "pass");
  assert.equal(ruling.evidenceGap, null);
  assert.match(ruling.rationale ?? "", /read-back says confirmed/);
});

test("an unreachable read-back withholds the pass and says which gap it is", () => {
  const ruling = applyEffectRule({ ...passed, observation: observation("unavailable") });
  assert.equal(ruling.status, "error");
  assert.equal(ruling.evidenceGap, "read_back_unavailable");
});

test("no read-back configured is still a different gap from a broken one", () => {
  // One is "nobody asked us to verify this"; the other is "we tried and could not".
  const ruling = applyEffectRule({ ...passed, observation: null });
  assert.equal(ruling.evidenceGap, "no_state_evidence");
});

test("a tool_invoked scenario is unaffected by a read-back", () => {
  const ruling = applyEffectRule({
    ...passed,
    effect: { describe: "a refund tool is called", evidence: "tool_invoked" },
    observation: observation("unavailable"),
  });
  assert.equal(ruling.status, "pass");
});
