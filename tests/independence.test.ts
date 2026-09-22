import { test } from "node:test";
import assert from "node:assert/strict";
import { independenceOf, vendorsOf, vendorOf } from "../src/lib/judge/independence.ts";

test("two vendors agreeing is independent corroboration", () => {
  assert.equal(
    independenceOf([
      { model: "groq/openai/gpt-oss-120b", status: "fail" },
      { model: "mistral/ministral-3b-latest", status: "fail" },
    ]),
    "independent",
  );
});

test("two models from one vendor are corroboration within that vendor, not across", () => {
  assert.equal(
    independenceOf([
      { model: "groq/openai/gpt-oss-120b", status: "fail" },
      { model: "groq/openai/gpt-oss-20b", status: "fail" },
    ]),
    "single-vendor",
  );
});

test("a vendor that errored corroborated nothing", () => {
  // The whole point: an unreachable second model must not read as a second opinion.
  assert.equal(
    independenceOf([
      { model: "groq/openai/gpt-oss-120b", status: "pass" },
      { model: "mistral/ministral-3b-latest", status: "error" },
    ]),
    "single-model",
  );
});

test("no votes at all is not corroborated", () => {
  assert.equal(independenceOf([]), "single-model");
  assert.equal(independenceOf(null), "single-model");
});

test("the vendor is the connection, however many slashes the model name has", () => {
  assert.equal(vendorOf("groq/openai/gpt-oss-120b"), "groq");
  assert.equal(vendorOf("unknown"), "unknown");
});

test("vendors are listed once each, in the order they voted", () => {
  assert.deepEqual(
    vendorsOf([
      { model: "groq/a", status: "pass" },
      { model: "mistral/b", status: "fail" },
      { model: "groq/c", status: "pass" },
      { model: "openrouter/d", status: "error" },
    ]),
    ["groq", "mistral"],
  );
});
