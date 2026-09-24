import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprint, windowResetMinutes, refusalMessage, SUPPORT_LIMIT, APPLY_LIMIT } from "../src/lib/support/throttle.ts";

/**
 * What it costs a stranger to make Novera do work.
 *
 * The forms these protect take anonymous POSTs, store a row and call a model. The bar
 * is not "blocks attackers" — it is "the product stays up for its one operator, and a
 * person with a real question still gets through".
 */

test("an identifier reveals neither the address nor the email", () => {
  const id = fingerprint(["support", "someone@example.com", "203.0.113.9"]);
  assert.equal(id.includes("example.com"), false);
  assert.equal(id.includes("203.0.113"), false);
  assert.match(id, /^[0-9a-f]{40}$/);
});

test("the same person is the same identifier, and case does not make a new one", () => {
  const a = fingerprint(["support", "Someone@Example.com", "203.0.113.9"]);
  const b = fingerprint(["support", "someone@example.com ", "203.0.113.9"]);
  assert.equal(a, b);
});

test("the two forms count separately", () => {
  // Asking a question and applying for a trial are different acts. One should not
  // spend the other's allowance.
  const question = fingerprint(["support", "a@b.co", "1.2.3.4"]);
  const application = fingerprint(["apply", "a@b.co", "1.2.3.4"]);
  assert.notEqual(question, application);
});

test("a missing address still yields a usable identifier", () => {
  // Behind some proxies there is no forwarded address at all. Falling back to the
  // email alone still limits the common case; refusing to count would not.
  const withIp = fingerprint(["support", "a@b.co", "1.2.3.4"]);
  const without = fingerprint(["support", "a@b.co", null]);
  assert.match(without, /^[0-9a-f]{40}$/);
  assert.notEqual(withIp, without);
});

test("the wait is reported in whole minutes, and never as zero", () => {
  // "Try again in 0 minutes" is a refusal with no next step in it.
  for (const now of [0, 1_000, 3_599_000, 3_600_000, 1_790_000_123_456]) {
    const minutes = windowResetMinutes(3600, now);
    assert.ok(minutes >= 1 && minutes <= 60, `${minutes} from ${now}`);
  }
  assert.equal(windowResetMinutes(3600, 0), 60);
});

test("the refusal says when, and offers a way that does not involve waiting", () => {
  const message = refusalMessage(42);
  assert.match(message, /about 42 minutes/);
  assert.match(message, /support@nover\.space/);
  // Our vocabulary for our problem. A person reading this did nothing wrong.
  assert.equal(/rate limit|throttled|blocked|denied/i.test(message), false);
});

test("the limits are generous enough for a person and too small for a script", () => {
  for (const limit of [SUPPORT_LIMIT, APPLY_LIMIT]) {
    assert.ok(limit.max >= 3, "someone with a real problem writes more than twice");
    assert.ok(limit.max <= 10, "a script should exhaust this in seconds");
    assert.equal(limit.windowSeconds, 3600);
  }
});
