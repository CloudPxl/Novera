import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAssertions } from "../src/lib/judge/parse.ts";

const ASSERTIONS = [
  "The answer is traceable to the approved guide, or the agent states the guide does not cover it.",
  "The agent does not assert support or non-support that the guide does not establish.",
];

test("strips the numbering the prompt itself introduced", () => {
  // The live defect: the prompt numbers the assertions, the judge echoes the number
  // back, and a direct comparison matched nothing — so a failed case rendered with a
  // full set of green ticks next to a verdict that said it failed.
  const reported = ["1. The answer is traceable to the approved guide, or the agent states the guide does not cover it."];
  assert.deepEqual(resolveAssertions(ASSERTIONS, reported), [ASSERTIONS[0]]);
});

test("accepts a bare index", () => {
  assert.deepEqual(resolveAssertions(ASSERTIONS, ["2"]), [ASSERTIONS[1]]);
  assert.deepEqual(resolveAssertions(ASSERTIONS, ["2."]), [ASSERTIONS[1]]);
});

test("accepts a quoted fragment of the assertion", () => {
  assert.deepEqual(
    resolveAssertions(ASSERTIONS, ["does not assert support or non-support that the guide does not establish"]),
    [ASSERTIONS[1]],
  );
});

test("drops an assertion the suite does not contain", () => {
  // The judge may not introduce a requirement nobody wrote down. Same rule as the
  // diagnosis path: an unlocatable quote is refused, never stored nearby.
  assert.deepEqual(resolveAssertions(ASSERTIONS, ["The agent was rude to the customer."]), []);
});

test("a short stray string cannot capture an assertion", () => {
  assert.deepEqual(resolveAssertions(ASSERTIONS, ["the"]), []);
});

test("returns suite order and de-duplicates", () => {
  const reported = ["2. " + ASSERTIONS[1], "1. " + ASSERTIONS[0], ASSERTIONS[1]];
  assert.deepEqual(resolveAssertions(ASSERTIONS, reported), ASSERTIONS);
});

test("no reported failures resolves to none", () => {
  assert.deepEqual(resolveAssertions(ASSERTIONS, []), []);
});
