import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { seal, open, secretAad, encryptionKey, tokenMatches } from "../src/lib/crypto.ts";

const key = randomBytes(32);

test("a sealed value opens back to the original", () => {
  const aad = secretAad("ws-1", "judge_key");
  const sealed = seal("sk-ant-not-a-real-key", aad, key);
  assert.notEqual(sealed.ciphertext, "sk-ant-not-a-real-key");
  assert.equal(open(sealed, aad, key), "sk-ant-not-a-real-key");
});

test("a ciphertext moved to another workspace fails to open", () => {
  const sealed = seal("secret-value", secretAad("ws-1", "judge_key"), key);
  assert.throws(() => open(sealed, secretAad("ws-2", "judge_key"), key));
});

test("a tampered ciphertext fails to open", () => {
  const aad = secretAad("ws-1", "agent_auth", "agent-9");
  const sealed = seal("secret-value", aad, key);
  const flipped = Buffer.from(sealed.ciphertext, "base64");
  flipped[0] ^= 0xff;
  assert.throws(() => open({ ...sealed, ciphertext: flipped.toString("base64") }, aad, key));
});

test("the same plaintext seals differently each time", () => {
  const aad = secretAad("ws-1", "judge_key");
  assert.notEqual(seal("same", aad, key).ciphertext, seal("same", aad, key).ciphertext);
});

test("a key of the wrong length is rejected", () => {
  assert.throws(() => encryptionKey(Buffer.alloc(16).toString("base64")), /32 bytes/);
  assert.throws(() => encryptionKey(undefined), /not set/);
});

test("token comparison handles unequal lengths", () => {
  assert.equal(tokenMatches("abc", "abc"), true);
  assert.equal(tokenMatches("abc", "abcd"), false);
  assert.equal(tokenMatches("abc", "abd"), false);
});
