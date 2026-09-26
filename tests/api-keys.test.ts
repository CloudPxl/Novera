import { test } from "node:test";
import assert from "node:assert/strict";
import { hashKey, keyFromHeader, mintKey, sameHash } from "../src/lib/api/keys.ts";

const SECRET = "test-secret-for-hashing-only";

test("a key has our shape, a short prefix to tell keys apart, and a fingerprint that is not the key", () => {
  const { key, prefix, hash } = mintKey(SECRET);
  assert.match(key, /^nvk_[A-Za-z0-9_-]{43}$/);
  assert.equal(prefix, key.slice(0, 12));
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.ok(!hash.includes(key.slice(4, 12)));
  assert.notEqual(mintKey(SECRET).key, key, "two keys were the same");
});

test("the fingerprint depends on the server's secret, so the table alone opens nothing", () => {
  const { key } = mintKey(SECRET);
  assert.equal(hashKey(key, SECRET), hashKey(key, SECRET));
  assert.notEqual(hashKey(key, SECRET), hashKey(key, "another-secret"));
  assert.throws(() => hashKey(key, ""), /NOVERA_ENCRYPTION_KEY/);
});

test("only a bearer header carrying one of our keys is read", () => {
  const { key } = mintKey(SECRET);
  assert.equal(keyFromHeader(`Bearer ${key}`), key);
  assert.equal(keyFromHeader(`bearer ${key}  `), key);
  for (const bad of [null, "", key, `Basic ${key}`, "Bearer sk-live-abc", `Bearer ${key}x`, `Bearer ${key} extra`]) {
    assert.equal(keyFromHeader(bad), null, String(bad));
  }
});

test("fingerprints are compared in constant time, and never equal when malformed", () => {
  const h = hashKey(mintKey(SECRET).key, SECRET);
  assert.ok(sameHash(h, h));
  assert.ok(!sameHash(h, hashKey(mintKey(SECRET).key, SECRET)));
  assert.ok(!sameHash("", ""));
  assert.ok(!sameHash(h, h.slice(0, 10)));
});
