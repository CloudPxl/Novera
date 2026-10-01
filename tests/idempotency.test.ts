import { test } from "node:test";
import assert from "node:assert/strict";
import { IDEMPOTENCY_KEY, requestHash } from "../src/lib/api/idempotency.ts";

test("the same request has the same fingerprint; anything that changes the run changes it", () => {
  const base = { agentId: "a", suiteId: null };
  assert.equal(requestHash(base), requestHash({ ...base }));
  assert.equal(requestHash(base), requestHash({ ...base, releaseId: undefined }), "an absent field is the same as an omitted one");
  for (const changed of [{ agentId: "b" }, { suiteId: "s" }, { releaseId: "r1" }, { knowledgeBaseRevision: "k1" }]) {
    assert.notEqual(requestHash({ ...base, ...changed }), requestHash(base), JSON.stringify(changed));
  }
  assert.notEqual(requestHash({ ...base, releaseId: "x" }), requestHash({ ...base, knowledgeBaseRevision: "x" }), "fields are not interchangeable");
});

test("a key is 1 to 200 visible characters: no spaces, no control characters", () => {
  for (const ok of ["release-2026-10-01", "gh_1234_attempt_2", "x".repeat(200)]) assert.ok(IDEMPOTENCY_KEY.test(ok), ok);
  for (const bad of ["", "x".repeat(201), "has space", "tab\there", "line\nbreak"]) assert.ok(!IDEMPOTENCY_KEY.test(bad), JSON.stringify(bad));
});
