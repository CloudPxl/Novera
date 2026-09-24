import { test } from "node:test";
import assert from "node:assert/strict";
import { explainKeyFailure } from "../src/lib/providers/key-failure.ts";
import { ProviderError } from "../src/lib/providers/types.ts";

/**
 * The form takes a key and a model. One message for both was a message that sent
 * customers to rotate a working credential because a model id had moved.
 */
const fail = (status: number | undefined, message = "something went wrong") =>
  new ProviderError("openai-compatible", message, status);

test("a rejected credential is named as the credential", () => {
  for (const status of [401, 403]) {
    const said = explainKeyFailure("groq", "openai/gpt-oss-120b", fail(status));
    assert.match(said, /did not accept this key/);
    // It may mention that a key can be scoped to particular models — that is a real
    // cause of a 403. What it must never do is name the model the customer typed as
    // the thing that was wrong, which is the misdirection this function exists to end.
    assert.doesNotMatch(said, /openai\/gpt-oss-120b/);
  }
});

test("an unknown model says the key works", () => {
  // Measured against Groq on 2026-09-24: a valid key with an unknown model is a 404.
  const said = explainKeyFailure("groq", "not-a-model", fail(404, "The model `not-a-model` does not exist"));
  assert.match(said, /^The key works\./);
  assert.match(said, /"not-a-model"/);
});

test("a 400 that talks about the model is the model, and one that does not is not", () => {
  assert.match(
    explainKeyFailure("mistral", "x", fail(400, "Invalid model identifier")),
    /does not offer a model/,
  );
  assert.match(
    explainKeyFailure("mistral", "x", fail(400, "Malformed request body")),
    /That key did not work/,
  );
});

test("a rate limit is not a wrong key, and says nothing was saved", () => {
  const said = explainKeyFailure("groq", "m", fail(429, "Rate limit reached"));
  assert.match(said, /rate-limiting/);
  assert.match(said, /Nothing was saved/);
  assert.doesNotMatch(said, /did not accept this key/);
});

test("the provider's outage is attributed to the provider", () => {
  assert.match(explainKeyFailure("openrouter", "m", fail(503)), /That is their side/);
});

test("an unclassifiable failure still carries the provider's own words", () => {
  // Better a verbatim upstream message than a confident wrong diagnosis; the message
  // has already been through redactCredentials by the time it arrives here.
  assert.match(
    explainKeyFailure("groq", "m", fail(undefined, "socket hang up")),
    /socket hang up/,
  );
  assert.match(explainKeyFailure("groq", "m", "not an Error at all"), /not an Error at all/);
});
