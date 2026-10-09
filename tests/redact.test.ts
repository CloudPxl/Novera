import { test } from "node:test";
import assert from "node:assert/strict";
import { redact } from "../src/lib/redact/pii.ts";
import { redactForStorage } from "../src/lib/redact/store.ts";

test("emails, phones, IBANs, cards, IPs and keys are replaced with stable placeholders", () => {
  const input = [
    "I'm jane.doe@example.co.uk, call me on +44 20 7946 0958 or 07700 900123.",
    "Refund to DE89 3704 0044 0532 0130 00, card 4111 1111 1111 1111.",
    "My IP is 192.168.10.4 and my key is sk-live-abcdef1234567890.",
    "Again: jane.doe@example.co.uk",
  ].join("\n");
  const r = redact(input);
  assert.equal(r.text, [
    "I'm [EMAIL_1], call me on [PHONE_1] or [PHONE_2].",
    "Refund to [IBAN_1], card [CARD_1].",
    "My IP is [IP_1] and my key is [SECRET_1].",
    "Again: [EMAIL_1]",
  ].join("\n"));
  assert.deepEqual(r.counts, { EMAIL: 1, PHONE: 2, IBAN: 1, CARD: 1, IP: 1, SECRET: 1 });
});

test("order numbers, dates, prices and versions are left alone", () => {
  const text = "Order 55120 and order 1234567890123 (not a card), placed 2026-09-12, €49.99, v2.3.1, 3 items.";
  assert.equal(redact(text).text, text);
});

test("the original is represented only by its hash", () => {
  const { fields, record } = redactForStorage({ message: "Email me at a@b.io", reply: "Sure." });
  assert.equal(fields.message, "Email me at [EMAIL_1]");
  assert.match(record.original_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(record.original_hash, record.redacted_hash);
  assert.ok(!JSON.stringify(record).includes("a@b.io"));
  assert.match(record.not_detected, /Names and street addresses/);
});

test("redacting twice changes nothing more", () => {
  const once = redact("Call +49 30 123456789, mail x@y.de").text;
  assert.equal(redact(once).text, once);
});

// Audit 2026-10-01, C6: the email pattern had no left boundary, so a long unbroken token
// with no "@" — a hash dump, a base64 attachment — cost time quadratic in its length
// (64 KB: 6.9 s; 128 KB: 27 s), on every report seal and every redacted model call.
// Each input below is shaped to make one pattern family backtrack; each must stay linear.
test("redaction takes linear time on inputs built to make its patterns backtrack", { timeout: 20_000 }, () => {
  const kb = (n: number, unit: string) => unit.repeat(Math.ceil((n * 1024) / unit.length)).slice(0, n * 1024);
  const shapes: Record<string, (n: number) => string> = {
    "one letter": (n) => kb(n, "x"),
    "hex": (n) => kb(n, "0123456789abcdef"),
    "base64url": (n) => kb(n, "Ab9-_zQ"),
    "local part then @ and no dot": (n) => `a@${kb(n, "x")}`,
    "dotted with no top-level domain": (n) => `a@${kb(n, "x.")}1`,
    "digits": (n) => kb(n, "7"),
    "digits and separators": (n) => kb(n, "0 1-"),
    "international prefixes": (n) => kb(n, "+1 "),
    "uppercase and digits": (n) => kb(n, "GB12AB"),
    "key-shaped prefix": (n) => `sk-${kb(n, "a")}`,
  };
  for (const [shape, make] of Object.entries(shapes)) {
    const time = (n: number) => { const text = make(n); const t = performance.now(); redact(text); return performance.now() - t; };
    time(8); // warm up
    const small = time(64), large = time(256);
    assert.ok(small < 250, `${shape}: 64 KB took ${small.toFixed(0)} ms`);
    // Four times the input may take somewhat more than four times as long, never sixteen.
    assert.ok(large < Math.max(8 * small, 120), `${shape}: 256 KB took ${large.toFixed(0)} ms against ${small.toFixed(0)} ms for 64 KB`);
  }
});

test("bounding the patterns still finds what they found", () => {
  const long = "x".repeat(100_000);
  const r = redact(`${long} contact first.last+tag@mail.example.co.uk or ${long}`);
  assert.equal(r.counts.EMAIL, 1);
  assert.match(r.text, /\[EMAIL_1\]/);
  assert.equal(redact("a.b@c.io, ops@sub.domain.example").counts.EMAIL, 2);
  assert.equal(redact("not.an.email@nodot").counts.EMAIL ?? 0, 0);
});

test("a record's fields share one numbering, so the same address is the same placeholder", async () => {
  const { redactFields } = await import("../src/lib/redact/pii.ts");
  const r = redactFields({
    customer_message: "I'm old@example.com, change my account email to new@example.org",
    agent_reply: "Done. Your email is now new@example.org",
  });
  assert.equal(r.fields.customer_message, "I'm [EMAIL_1], change my account email to [EMAIL_2]");
  assert.equal(r.fields.agent_reply, "Done. Your email is now [EMAIL_2]", "the agent set the new address, and the record still says so");
  assert.equal(r.counts.EMAIL, 2, "two addresses, counted once each");
});

test("Novera's own keys and common platform tokens are redacted as secrets", async () => {
  const { redact } = await import("../src/lib/redact/pii.ts");
  for (const s of ["nvk_Abc123def456ghi", "whsec_4f2c1aDEADbeef99", "ghp_abcdefghijklmnop1234", "AKIAABCDEFGHIJKLMNOP"]) {
    assert.equal(redact(`key: ${s}`).text, "key: [SECRET_1]", s);
  }
  assert.equal(redact("card 4111 1111 1111 1111, mail a@b.eu", { only: ["SECRET", "CARD", "IBAN"] }).text, "card [CARD_1], mail a@b.eu", "the support form keeps addresses");
});
