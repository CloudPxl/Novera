import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { API_BODY_LIMIT, BodyTooLarge, bodyTooLarge, readJsonBody } from "../src/lib/api/body.ts";

const req = (body: string, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/v1/runs", { method: "POST", body, headers: { "content-type": "application/json", ...headers } });

test("an API body within the limit is parsed; past it, it is refused before parsing, declared or not", async () => {
  assert.deepEqual(await readJsonBody(req(JSON.stringify({ agent_id: "a" }))), { agent_id: "a" });
  const big = JSON.stringify({ x: "y".repeat(API_BODY_LIMIT + 10) });
  await assert.rejects(readJsonBody(req(big, { "content-length": String(big.length) })), BodyTooLarge);
  await assert.rejects(readJsonBody(req(big)), BodyTooLarge);
  await assert.rejects(readJsonBody(req("{not json")), SyntaxError);
  const refusal = bodyTooLarge();
  assert.equal(refusal.status, 413);
  assert.equal(((await refusal.json()) as { code: string }).code, "payload_too_large");
});

test("every /api/v1 write route reads its body through the limit, never request.json()", () => {
  for (const route of [
    "src/app/api/v1/runs/route.ts",
    "src/app/api/v1/ci/trigger/route.ts",
    "src/app/api/v1/agents/test-connection/route.ts",
    "src/app/api/v1/production-failures/route.ts",
    "src/app/api/v1/probes/single/route.ts",
  ]) {
    const source = readFileSync(route, "utf8");
    assert.doesNotMatch(source, /request\.json\(\)/, `${route} parses an unbounded body`);
    assert.match(source, /BodyTooLarge/, `${route} does not answer an oversized body with 413`);
  }
});
