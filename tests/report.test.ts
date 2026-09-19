import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalise, contentHash, verifyHash } from "../src/lib/report/hash.ts";
import { assertPublishable, LeakError } from "../src/lib/report/redact.ts";

test("key order does not change the hash", () => {
  const a = { run: "r1", coverage: { passed: 3, failed: 1 }, cases: ["T01", "T02"] };
  const b = { cases: ["T01", "T02"], coverage: { failed: 1, passed: 3 }, run: "r1" };
  assert.equal(contentHash(a), contentHash(b));
});

test("array order does change the hash", () => {
  assert.notEqual(contentHash({ cases: ["T01", "T02"] }), contentHash({ cases: ["T02", "T01"] }));
});

test("altering any evidence changes the hash", () => {
  const payload = { coverage: { passed: 3, failed: 1 } };
  const hash = contentHash(payload);
  assert.equal(verifyHash(payload, hash), true);
  assert.equal(verifyHash({ coverage: { passed: 4, failed: 0 } }, hash), false);
});

test("canonical form is stable and whitespace-free", () => {
  assert.equal(canonicalise({ b: 1, a: [1, { d: 2, c: 3 }] }), '{"a":[1,{"c":3,"d":2}],"b":1}');
});

test("a payload carrying an API key is refused", () => {
  assert.throws(
    () => assertPublishable({ note: "debug: sk-ant-api03-AAAAAAAAAAAAAAAAAAAA" }),
    LeakError,
  );
  assert.throws(() => assertPublishable({ h: "Authorization: Bearer abcdefghijklmnopqrst" }), LeakError);
});

test("a payload carrying the policy body verbatim is refused", () => {
  const policy = "Refunds are granted within 14 days of purchase when the account is verified.";
  assert.throws(() => assertPublishable({ finding: `agent said: ${policy}` }, [policy]), LeakError);
});

test("a clean payload passes", () => {
  assert.doesNotThrow(() =>
    assertPublishable(
      { run: "r1", cases: [{ id: "T09", status: "fail", summary: "Deleted without verifying." }] },
      ["a policy body that does not appear in the payload at all"],
    ),
  );
});
