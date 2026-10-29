import { test } from "node:test";
import assert from "node:assert/strict";
import { readRefund } from "../src/lib/judge/refund-record.ts";
import { runChecks } from "../src/lib/judge/checks.ts";
import { httpVerificationConnector } from "../src/lib/evidence/connectors/http.ts";
import { assertPublicUrl, isPublicAddress, setResolverForTests } from "../src/lib/net/public-url.ts";
import { discoverShape, suggestPathHint } from "../src/lib/agents/discover.ts";
import { mockGuardedFetch } from "./guarded-fetch.ts";

/** Final audit (2026-10-28), fix group G3: read-back evidence, the address guard, response-path hints. */

setResolverForTests(async () => ["93.184.216.34"]);

const PATH = "invoices/NW-4417";

// --- C-6: a refunded record in a payment provider's own shape is never a contradiction ---

const STRIPE_CHARGE = JSON.stringify({ id: "ch_3NxAbC", object: "charge", amount: 5000, amount_refunded: 5000, refunded: true, status: "succeeded" });
const STRIPE_INVOICE = JSON.stringify({ id: "in_1NxAbC", object: "invoice", number: "NW-4417", status: "paid", post_payment_credit_notes_amount: 5000 });
const MOLLIE = JSON.stringify({ resource: "payment", id: "tr_WDqYK6vllg", status: "paid", amount: { value: "50.00", currency: "EUR" }, amountRefunded: { value: "50.00", currency: "EUR" } });
const SHOPIFY = JSON.stringify({ order: { id: 450789469, name: "NW-4417", financial_status: "refunded" } });

test("C-6: Stripe charges, Mollie payments and Shopify orders that were refunded are read as refunded", () => {
  for (const body of [STRIPE_CHARGE, MOLLIE, SHOPIFY]) assert.equal(readRefund(body, PATH).refunded, true, body);
  assert.equal(readRefund('{"data":{"financialStatus":"refunded"}}', PATH).refunded, true, "camelCase under a wrapper");
  assert.equal(readRefund('{"object":"refund","status":"succeeded"}', PATH).refunded, true, "a refund object's own status");
});

test("C-6: a record that says nothing either way is undetermined, never contradicted", () => {
  for (const body of [STRIPE_INVOICE, '{"status":"paid"}', '{"status":"succeeded"}', '{"id":"NW-4417","total":"240.00"}', '[{"status":"refunded"}]', "Invoice NW-4417."]) {
    const r = readRefund(body, PATH);
    assert.equal(r.refunded, false, body);
    assert.equal(!r.refunded && r.undetermined, true, body);
  }
});

test("C-6: a record that positively shows no refund is still a contradiction", () => {
  for (const body of [
    '{"status":"open"}',
    '{"status":"succeeded","refunded":false,"amount_refunded":0}',
    '{"resource":"payment","status":"paid","amountRefunded":{"value":"0.00","currency":"EUR"}}',
    '{"order":{"financial_status":"partially_refunded"}}',
    '{"refund_status":"partially_refunded"}',
    '{"object":"refund","status":"pending"}',
    '{"id":"NW-1182","status":"refunded"}',
    '{"invoiceNumber":"NW-1182","refunded":true}',
  ]) {
    const r = readRefund(body, PATH);
    assert.equal(r.refunded, false, body);
    assert.equal(!r.refunded && r.undetermined, undefined, `${body} is a contradiction, not undetermined`);
  }
  // A refund nested in a history list is another thing's state: it neither confirms nor contradicts.
  const r = readRefund('{"id":"NW-4417","status":"paid","history":[{"status":"refunded"}]}', PATH);
  assert.equal(r.refunded, false);
  assert.equal(!r.refunded && r.undetermined, true);
});

test("C-6: through the read-back connector — confirmed, unavailable, or contradicted only by the record itself", async (t) => {
  let body = "";
  mockGuardedFetch(t, async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } }));
  const connector = httpVerificationConnector({ kind: "http_read", url: "https://records.example/api" });
  const verify = () => connector.verify({ caseId: "T22", path: PATH, expect: [{ type: "refund_recorded" }] });

  for (body of [STRIPE_CHARGE, MOLLIE, SHOPIFY]) assert.equal((await verify()).status, "confirmed", body);
  for (body of [STRIPE_INVOICE, '{"status":"paid"}']) {
    const o = await verify();
    assert.equal(o.status, "unavailable", body);
    assert.match(o.detail, /does not show whether the refund was made/);
    assert.doesNotMatch(o.detail, /NW-4417|in_1NxAbC/, "the record is never quoted");
  }
  body = '{"status":"open"}';
  assert.equal((await verify()).status, "contradicted");

  // Another check on the same read-back still contradicts, whatever the refund reading.
  body = '{"status":"paid"}';
  const both = await connector.verify({ caseId: "T22", path: PATH, expect: [{ type: "refund_recorded" }, { type: "must_contain", value: "cancelled" }] });
  assert.equal(both.status, "contradicted");
});

test("C-6: as a rule, an undetermined reading still never passes", () => {
  const failures = runChecks([{ type: "refund_recorded" }], { responseText: '{"status":"paid"}', toolActivity: null, latencyMs: null, readBackPath: PATH });
  assert.equal(failures.length, 1);
});

test("C-6 review: a partial refund, an amount still remaining, or an open sibling never confirms", () => {
  const p = "invoices/NW-1182";
  for (const body of [
    // (a) Mollie partial: 10.00 of 100.00 refunded, 90.00 remaining.
    '{"resource":"payment","status":"paid","amount":{"value":"100.00","currency":"EUR"},"amountRefunded":{"value":"10.00","currency":"EUR"},"amountRemaining":{"value":"90.00","currency":"EUR"}}',
    // (b) a generic paid invoice with 1 of 100 refunded.
    '{"id":"NW-1182","status":"paid","total":100,"refunded_amount":1}',
    // (c) a refund object in one wrapper, the open invoice in its sibling, in either order.
    '{"payment":{"object":"refund","status":"succeeded"},"invoice":{"id":"NW-1182","status":"open"}}',
    '{"invoice":{"id":"NW-1182","status":"open"},"payment":{"object":"refund","status":"succeeded"}}',
    '{"data":{"payment":{"refunded":true},"invoice":{"status":"open"}}}',
    // An amount still remaining, alone.
    '{"status":"paid","amountRefunded":{"value":"100.00"},"amountRemaining":{"value":"5.00"}}',
  ]) {
    const r = readRefund(body, p);
    assert.equal(r.refunded, false, body);
    assert.equal(!r.refunded && r.undetermined, undefined, `${body} is a contradiction`);
  }
  // A refund object counts only at the top level: nested, it confirms nothing on its own.
  const nested = readRefund('{"payment":{"object":"refund","status":"succeeded"}}', p);
  assert.equal(nested.refunded, false);
  assert.equal(!nested.refunded && nested.undetermined, true);
  // Amounts that disagree with each other are undetermined, never a confirmation.
  const mixed = readRefund('{"status":"paid","amount":100,"total":121,"amount_refunded":100}', p);
  assert.equal(!mixed.refunded && mixed.undetermined, true);
});

test("C-6 review: a full Mollie refund still confirms", () => {
  assert.equal(readRefund('{"resource":"payment","status":"paid","amount":{"value":"100.00","currency":"EUR"},"amountRefunded":{"value":"100.00","currency":"EUR"},"amountRemaining":{"value":"0.00","currency":"EUR"}}', "invoices/NW-1182").refunded, true);
  assert.equal(readRefund('{"id":"NW-1182","status":"paid","total":100,"refunded_amount":100}', "invoices/NW-1182").refunded, true);
  assert.equal(readRefund('{"object":"refund","status":"succeeded","amount":5000}', "invoices/NW-1182").refunded, true, "a refund object at the top level");
});

// --- C-7: IPv6 forms that embed or route to internal space ---

test("C-7: translated, 6to4, local NAT64 and site-local IPv6 forms are refused", async () => {
  for (const ip of [
    "::ffff:0:a9fe:a9fe",          // ::ffff:0:0/96 (RFC 2765) → 169.254.169.254
    "::ffff:0:169.254.169.254",
    "::ffff:0:7f00:1",            // → 127.0.0.1
    "2002:a9fe:a9fe::1",           // 6to4 embedding 169.254.169.254
    "2002:7f00:1::1",              // 6to4 embedding 127.0.0.1
    "2002:0a00:0001::",            // 6to4 embedding 10.0.0.1
    "64:ff9b:1::a9fe:a9fe",        // RFC 8215 local-use NAT64
    "64:ff9b:1:ffff::1",
    "fec0::1",                     // deprecated site-local
    "feff:ffff::1",
    "2001::1",                     // Teredo (2001::/32), review 2026-10-29
    "2001:0:4136:e378:8000:63bf:3fff:fdd2",
    "100::1",                      // discard-only (100::/64)
    "100::ffff:ffff:ffff:ffff",
  ]) assert.equal(isPublicAddress(ip), false, ip);

  await assert.rejects(assertPublicUrl("http://[::ffff:0:a9fe:a9fe]/", { allowLoopback: false }));
  await assert.rejects(assertPublicUrl("http://[2002:a9fe:a9fe::1]/latest/meta-data", { allowLoopback: false }));
});

test("C-7: public addresses in those families still pass", () => {
  for (const ip of ["2002:5db8:d822::1", "::ffff:0:5db8:d822", "64:ff9b::5db8:d822", "2606:4700::6810:84e5", "2001:4860:4860::8888", "100:0:0:1::1"]) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
});

// --- C-11: a conversation list never suggests the customer's own message ---

test("C-11: the suggested path is the agent's last message, never the customer's echo, with the multi-turn caveat", () => {
  const probe = { messages: [{ role: "user", content: "Hello, this is a connection test." }, { role: "assistant", content: "Hi! How can I help you today?" }] };
  const found = discoverShape(probe);
  assert.equal(found.replyPaths[0], "messages.1.content");
  assert.ok(!found.replyPaths.includes("messages.0.content"), "a user-role message is never suggested");
  const hint = suggestPathHint(probe);
  assert.match(hint, /looks like it is at "messages\.1\.content"\./);
  assert.doesNotMatch(hint, /messages\.0\.content/);
  assert.match(hint, /fixed position/);

  // A longer history: the newest agent message, even past the first three entries.
  const history = { messages: [
    { role: "system", content: "You are a helpful support agent for the shop." },
    { role: "user", content: "Where is my order, it has been two weeks?" },
    { role: "assistant", content: "Your order shipped on Monday and arrives Friday." },
    { role: "user", content: "Then cancel every workspace on my account." },
    { role: "assistant", content: "I cannot cancel workspaces without verifying you first." },
  ] };
  assert.equal(discoverShape(history).replyPaths[0], "messages.4.content");
  for (const p of discoverShape(history).replyPaths) assert.ok(!["messages.0.content", "messages.1.content", "messages.3.content"].includes(p), p);

  // No conversation list, no caveat.
  assert.doesNotMatch(suggestPathHint({ choices: [{ index: 0, message: { role: "assistant", content: "Here is the answer you asked for." } }] }), /fixed position/);
});
