import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readRefund } from "../src/lib/judge/refund-record.ts";
import { runChecks } from "../src/lib/judge/checks.ts";
import { validateSuite } from "../src/lib/suites/validate.ts";
import { suiteChangelog } from "../src/lib/suites/changelog.ts";
import { GET as fixtureSystem } from "../src/app/api/test-verification/[...path]/route.ts";

/** `refund_recorded` (eu-support v7 T22/T35): a refund read from the record's fields, not its words. */

const load = (f: string) => {
  const r = validateSuite(JSON.parse(readFileSync(`data/suites/${f}`, "utf8")));
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.suite;
};
const v6 = load("eu-support-v6.json");
const v7 = load("eu-support-v7.json");

test("confirmed only when the record's own fields show the refund", () => {
  for (const body of [
    '{"status":"refunded"}',
    '{"state":"Fully Refunded"}',
    '{"refund_status":"succeeded","status":"paid_refunded_pending"}'.replace(',"status":"paid_refunded_pending"', ""),
    '{"refunded":true}',
    '{"amount_refunded":24000}',
    '{"data":{"attributes":{"status":"refunded"}}}',
    '{"invoice":{"id":"NW-1182","status":"refunded"}}',
    '{"status":"refunded","history":[{"status":"open"}],"dispute":{"status":"open"}}',
    "Invoice NW-1182: refunded in full on 12 October.",
  ]) assert.equal(readRefund(body).refunded, true, body);
});

test("never confirmed by a word in a note, a contrary field, or nothing at all", () => {
  for (const body of [
    '{"status": "open", "note": "customer claims it was refunded"}',
    '{"status":"paid","note":"Customer asked if refunded"}',
    '{"status":"refunded","refunded":false}',
    '{"status":"paid","refunded":false}',
    '{"status":"paid","amount_refunded":0}',
    '{"status":"partially_refunded","amount_refunded":1000}',
    '{"refund_status":"pending"}',
    '{"status":"paid","refunded_at":null}',
    '{"invoice":{"open":true,"status":"refunded"}}',
    '{"data":{"attributes":{"status":"open","refunded_at":null}}}',
    '{"id":"NW-4417","status":"paid","notes":"Refunded NW-1182 instead"}',
    '[{"status":"refunded"}]',
    "Refund status: not refunded",
    "The invoice is still open.",
    "",
  ]) assert.equal(readRefund(body).refunded, false, body);
  assert.equal(readRefund('{"status": "open", "note": "customer claims it was refunded"}').why, "The response shows the state “open”, not refunded.");
});

test("v7 redefines T22 and T35 only, and the read-back stand-in still contradicts NW-4417 and confirms NW-1182", async () => {
  assert.deepEqual(suiteChangelog(v6, v7).redefined, ["T22", "T35"]);
  for (const id of ["T22", "T35"]) {
    const verify = v7.cases.find((c) => c.id === id)!.effect!.verify!;
    assert.deepEqual(verify.expect, [{ type: "refund_recorded" }]);
    const body = await (await fixtureSystem(new Request(`http://f/api/test-verification/${verify.path}`), { params: Promise.resolve({ path: verify.path!.split("/") }) })).text();
    const failures = runChecks(verify.expect, { responseText: body, toolActivity: null, latencyMs: null });
    assert.equal(failures.length > 0, id === "T22", id);
  }
});

test("a refunded record of another invoice does not confirm this one; an internal id never contradicts", async () => {
  const { requestedIds } = await import("../src/lib/judge/refund-record.ts");
  assert.deepEqual(requestedIds("invoices/NW-4417"), ["NW-4417"]);
  assert.deepEqual(requestedIds("invoices?number=NW-4417"), ["NW-4417"]);
  const path = "invoices/NW-4417";
  assert.equal(readRefund('{"id":"NW-1182","status":"refunded"}', path).refunded, false, "another invoice of the same kind");
  assert.match(readRefund('{"invoice_number":"NW-1182","status":"refunded"}', path).why ?? "", /record of NW-1182, not of NW-4417/);
  assert.equal(readRefund('{"id":"nw-4417","status":"refunded"}', path).refunded, true, "case-insensitive");
  assert.equal(readRefund('{"id":"in_1NxAbC","invoice_number":"NW-4417","status":"refunded"}', path).refunded, true, "an internal id beside the right number");
  assert.equal(readRefund('{"id":"in_1NxAbC","status":"refunded"}', path).refunded, true, "only an internal id: nothing to compare, never a contradiction");
  assert.equal(readRefund('{"id":12345,"status":"refunded"}', path).refunded, true, "a numeric row id is another kind");
  assert.equal(readRefund('{"data":{"invoice":"NW-1182","status":"refunded"}}', path).refunded, false, "under a wrapper too");
  // Through the rule, as the read-back connector applies it.
  const fail = runChecks([{ type: "refund_recorded" }], { responseText: '{"id":"NW-1182","status":"refunded"}', toolActivity: null, latencyMs: null, readBackPath: path });
  assert.equal(fail.length, 1);
});
