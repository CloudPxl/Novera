import { test } from "node:test";
import assert from "node:assert/strict";
import { signatureFor, verifySignature } from "../src/lib/webhooks/sign.ts";

const secret = "whsec_test_secret";
const body = JSON.stringify({ event: "run.completed", run: { id: "r1", outcome: "fail" } });
const now = 1_790_000_000_000;
const t = Math.floor(now / 1000);

test("a signature over the timestamp and body verifies with the same secret", () => {
  const header = signatureFor(secret, body, t);
  assert.match(header, /^t=\d+,v1=[0-9a-f]{64}$/);
  assert.equal(verifySignature({ secret, body, header, now }), true);
});

test("a changed body, another secret, an old timestamp or a malformed header all fail", () => {
  const header = signatureFor(secret, body, t);
  assert.equal(verifySignature({ secret, body: body.replace("fail", "pass"), header, now }), false);
  assert.equal(verifySignature({ secret: "whsec_other", body, header, now }), false);
  assert.equal(verifySignature({ secret, body, header, now: now + 301_000 }), false, "replayed after five minutes");
  assert.equal(verifySignature({ secret, body, header: "v1=abc", now }), false);
  assert.equal(verifySignature({ secret, body, header: null, now }), false);
  assert.equal(verifySignature({ secret, body, header: `t=${t},v1=zz`, now }), false);
});
