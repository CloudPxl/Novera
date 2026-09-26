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
